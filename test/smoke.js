// Logbin smoke test — boots the real server (HTTP + syslog UDP) and exercises:
// auth → source + api key → plaintext & NDJSON ingest with level detection →
// bad key 401 → search/filter → SSE live tail receives a freshly ingested
// line → syslog UDP datagram auto-creates a source and lands as error →
// alert rule (ERROR ≥3 in window) fires webhook exactly once → retention
// purge deletes old rows. Kills ONLY the spawned server child.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const dgram = require('node:dgram');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 5390 + 10;      // 5400
const SYSLOG_PORT = 5401;
const WEBHOOK_PORT = 5402;
const ADMIN_PASSWORD = 'smoke-admin-pw';
const DB_PATH = path.join(__dirname, 'smoke.db');
const BASE = `http://127.0.0.1:${TEST_PORT}`;

for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);

let serverProc = null;
let webhookServer = null;
const webhookHits = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, tries = 40, delay = 250) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(delay);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let cookie = '';
async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function ingest(key, body, contentType = 'text/plain') {
  return fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'Content-Type': contentType },
    body
  });
}

async function main() {
  console.log('1. Booting Logbin on port', TEST_PORT, '(syslog UDP', SYSLOG_PORT + ')');
  serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(TEST_PORT), SYSLOG_PORT: String(SYSLOG_PORT), ADMIN_PASSWORD, DB_PATH },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`   [server] ${d}`));
  await waitFor(async () => (await api('/api/health')).data.ok, 'server health');

  webhookServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { webhookHits.push(JSON.parse(body)); res.writeHead(200).end('{}'); });
  });
  await new Promise((r) => webhookServer.listen(WEBHOOK_PORT, '127.0.0.1', r));

  console.log('2. Auth + source creation');
  assert.strictEqual((await api('/api/sources')).status, 401, 'sources must require auth');
  assert.strictEqual((await api('/api/login', { method: 'POST', body: { password: ADMIN_PASSWORD } })).status, 200);
  const src = (await api('/api/sources', { method: 'POST', body: { name: 'api-server' } })).data;
  assert.ok(src.api_key.startsWith('lb_'), 'source gets an api key');

  console.log('3. Ingest: bad key 401, plaintext + NDJSON with level detection');
  assert.strictEqual((await ingest('lb_wrong', 'nope')).status, 401, 'bad api key must 401');
  const r1 = await ingest(src.api_key, 'plain boring line\nERROR database connection lost\nWARN retrying in 5s');
  assert.strictEqual(r1.status, 200);
  assert.strictEqual((await r1.json()).ingested, 3);
  const ndjson = '{"level":"error","msg":"payment failed","order":123}\n{"level":"debug","message":"cache miss"}';
  const r2 = await ingest(src.api_key, ndjson, 'application/json');
  assert.strictEqual((await r2.json()).ingested, 2);

  const all = (await api('/api/logs?limit=50')).data;
  assert.strictEqual(all.length, 5, 'all 5 lines stored');
  const errLine = all.find((l) => l.message.includes('database connection lost'));
  assert.strictEqual(errLine.level, 'error', 'plaintext ERROR detected as error level');
  const jsonLine = all.find((l) => l.message === 'payment failed');
  assert.ok(jsonLine && JSON.parse(jsonLine.raw_json).order === 123, 'NDJSON parsed with raw_json preserved');
  assert.strictEqual(all.find((l) => l.message.includes('retrying')).level, 'warn');

  console.log('4. Search + filters');
  const search = (await api('/api/logs?q=database')).data;
  assert.strictEqual(search.length, 1, 'full-text LIKE search');
  const errs = (await api(`/api/logs?level=error&source_id=${src.id}`)).data;
  assert.strictEqual(errs.length, 2, 'level filter');

  console.log('5. SSE live tail receives a fresh line');
  const tailRes = await fetch(`${BASE}/api/tail?source_id=${src.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual(tailRes.status, 200);
  const reader = tailRes.body.getReader();
  const dec = new TextDecoder();
  const tailPromise = (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      const m = buf.match(/data: (.+)\n\n/);
      if (m) return JSON.parse(m[1]);
    }
  })();
  await sleep(300);
  await ingest(src.api_key, 'LIVE-TAIL-MARKER hello');
  const tailed = await Promise.race([tailPromise, sleep(5000).then(() => null)]);
  assert.ok(tailed && tailed.message.includes('LIVE-TAIL-MARKER'), 'SSE tail delivered the new line');
  reader.cancel().catch(() => {});
  console.log('   ✓ SSE delivered:', tailed.message);

  console.log('6. Syslog UDP datagram → auto source, severity mapped');
  const udp = dgram.createSocket('udp4');
  await new Promise((r) => udp.send(Buffer.from('<11>myapp: disk failure imminent'), SYSLOG_PORT, '127.0.0.1', r));
  udp.close();
  const sysLine = await waitFor(async () => {
    const rows = (await api('/api/logs?q=disk failure')).data;
    return rows[0];
  }, 'syslog line ingested');
  assert.strictEqual(sysLine.level, 'error', 'syslog severity 3 → error');
  assert.ok(sysLine.source_name.startsWith('syslog:'), 'auto-created syslog source');

  console.log('7. Alert rule: ERROR ≥3 in window → webhook fires once');
  const rule = (await api('/api/rules', {
    method: 'POST',
    body: { name: 'error burst', pattern: 'ERROR|failed', threshold: 3, window_s: 120, webhook_url: `http://127.0.0.1:${WEBHOOK_PORT}/hook` }
  })).data;
  assert.ok(rule.id, 'rule created');
  assert.strictEqual((await api('/api/rules', { method: 'POST', body: { name: 'bad', pattern: '(' } })).status, 400, 'invalid regex rejected');
  await ingest(src.api_key, 'ERROR one\nERROR two\nERROR three');
  await waitFor(() => webhookHits.length > 0, 'alert webhook');
  const hit = webhookHits[0];
  assert.strictEqual(hit.event, 'log_alert');
  assert.ok(hit.matches_in_window >= 3, 'match count reported');
  assert.strictEqual(hit.rule, 'error burst');
  // more errors within cooldown → no second alert
  await ingest(src.api_key, 'ERROR four\nERROR five');
  await sleep(800);
  assert.strictEqual(webhookHits.length, 1, 'cooldown prevents alert spam');
  const events = (await api('/api/alert-events')).data;
  assert.ok(events.some((e) => e.rule_id === rule.id && e.ok === 1), 'alert event recorded ok=1');
  console.log(`   ✓ webhook: ${hit.rule} (${hit.matches_in_window} matches), deduped on repeat`);

  console.log('8. Retention purge');
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH); // writable: backdate rows
  db.prepare('UPDATE log_lines SET received_at = ? WHERE source_id = ?').run(Date.now() - 40 * 86400000, src.id);
  db.close();
  await api(`/api/sources/${src.id}`, { method: 'PUT', body: { retention_days: 14 } });
  const purged = (await api('/api/purge', { method: 'POST' })).data;
  assert.ok(purged.deleted >= 10, `purge deleted backdated rows (got ${purged.deleted})`);
  const after = (await api(`/api/logs?source_id=${src.id}`)).data;
  assert.strictEqual(after.length, 0, 'old rows gone after retention purge');

  console.log('\n✅ All Logbin smoke tests passed');
}

async function cleanup(code) {
  if (serverProc && !serverProc.killed) serverProc.kill();
  if (webhookServer) { webhookServer.close(); webhookServer.closeAllConnections?.(); }
  await sleep(300);
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* windows lock */ }
  }
  process.exit(code);
}

main()
  .then(() => cleanup(0))
  .catch(async (err) => {
    console.error('\n❌ Smoke test failed:', err.message);
    await cleanup(1);
  });
