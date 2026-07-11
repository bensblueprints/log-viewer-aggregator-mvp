// Logbin server — self-hosted log aggregation: HTTP + syslog ingest,
// SSE live tail, search, retention, alert rules.
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const { EventEmitter } = require('events');
const express = require('express');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const { openDb, genToken, genSessionToken } = require('./db');
const { parseBody, parseSyslog } = require('./ingest');

const SESSION_COOKIE = 'lb_session';
const COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#fb7185', '#4ade80', '#38bdf8'];

function createApp({ dbPath, adminPassword, autologinToken = null, syslogPort = 0, purgeIntervalMs = 3600000 } = {}) {
  const db = openDb(dbPath);
  const app = express();
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.locals.db = db;

  const findSourceByKey = db.prepare('SELECT * FROM sources WHERE api_key = ?');
  const insertLine = db.prepare('INSERT INTO log_lines (source_id, level, message, raw_json, received_at) VALUES (?, ?, ?, ?, ?)');

  // ── core ingest path ────────────────────────────────────────────────────────
  function ingestLines(source, lines) {
    const now = Date.now();
    const inserted = [];
    const tx = db.transaction(() => {
      for (const l of lines) {
        const info = insertLine.run(source.id, l.level, l.message.slice(0, 8192), l.raw_json, now);
        inserted.push({ id: info.lastInsertRowid, source_id: source.id, source_name: source.name, color: source.color, level: l.level, message: l.message.slice(0, 8192), received_at: now });
      }
    });
    tx();
    for (const row of inserted) bus.emit('line', row);
    evaluateRules(source, inserted).catch((e) => console.warn('[alerts]', e.message));
    return inserted.length;
  }

  // ── alert rules ─────────────────────────────────────────────────────────────
  async function evaluateRules(source, newLines) {
    const rules = db.prepare('SELECT * FROM alert_rules WHERE enabled = 1 AND (source_id IS NULL OR source_id = ?)').all(source.id);
    for (const rule of rules) {
      let re;
      try { re = new RegExp(rule.pattern, 'i'); } catch { continue; }
      if (!newLines.some((l) => re.test(l.message))) continue;
      const windowStart = Date.now() - rule.window_s * 1000;
      // count matches in window (regex applied in JS over the window's rows)
      const rows = rule.source_id
        ? db.prepare('SELECT message FROM log_lines WHERE source_id = ? AND received_at >= ?').all(rule.source_id, windowStart)
        : db.prepare('SELECT message FROM log_lines WHERE received_at >= ?').all(windowStart);
      const count = rows.reduce((n, r) => n + (re.test(r.message) ? 1 : 0), 0);
      if (count < rule.threshold) continue;
      if (rule.last_fired_at && Date.now() - rule.last_fired_at < rule.window_s * 1000) continue; // cooldown = window
      db.prepare('UPDATE alert_rules SET last_fired_at = ? WHERE id = ?').run(Date.now(), rule.id);
      const payload = {
        event: 'log_alert',
        rule: rule.name,
        pattern: rule.pattern,
        matches_in_window: count,
        threshold: rule.threshold,
        window_s: rule.window_s,
        source: source.name,
        sample: newLines.find((l) => re.test(l.message))?.message?.slice(0, 500)
      };
      const record = (channel, ok, error = null) =>
        db.prepare('INSERT INTO alert_events (rule_id, fired_at, match_count, channel, ok, error) VALUES (?, ?, ?, ?, ?, ?)')
          .run(rule.id, Date.now(), count, channel, ok ? 1 : 0, error);
      if (rule.webhook_url) {
        try {
          const res = await fetch(rule.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
          });
          record('webhook', res.ok, res.ok ? null : `HTTP ${res.status}`);
        } catch (e) { record('webhook', false, e.message); }
      }
      if (rule.email && process.env.SMTP_HOST) {
        try {
          const transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
          });
          await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: rule.email,
            subject: `[logbin] ${rule.name}: ${count} matches in ${rule.window_s}s`,
            text: JSON.stringify(payload, null, 2)
          });
          record('email', true);
        } catch (e) { record('email', false, e.message); }
      } else if (rule.email) {
        record('email', false, 'SMTP not configured');
      }
    }
  }

  // ── retention purge ─────────────────────────────────────────────────────────
  function purge() {
    let total = 0;
    for (const s of db.prepare('SELECT * FROM sources').all()) {
      const cutoff = Date.now() - s.retention_days * 86400000;
      total += db.prepare('DELETE FROM log_lines WHERE source_id = ? AND received_at < ?').run(s.id, cutoff).changes;
    }
    return total;
  }
  const purgeTimer = setInterval(purge, purgeIntervalMs);
  app.locals.stopPurge = () => clearInterval(purgeTimer);

  // ── HTTP ingest (api-key auth, NOT session auth) ───────────────────────────
  app.post('/ingest', express.text({ type: '*/*', limit: '5mb' }), (req, res) => {
    const key = req.headers['x-api-key'] || req.query.key ||
      (String(req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    const source = key ? findSourceByKey.get(String(key)) : null;
    if (!source) return res.status(401).json({ error: 'invalid api key' });
    const lines = parseBody(req.body, String(req.headers['content-type'] || ''));
    if (!lines.length) return res.status(400).json({ error: 'no log lines in body' });
    const n = ingestLines(source, lines);
    res.json({ ok: true, ingested: n });
  });

  // ── syslog UDP listener ─────────────────────────────────────────────────────
  let syslogSocket = null;
  if (syslogPort) {
    syslogSocket = dgram.createSocket('udp4');
    syslogSocket.on('message', (msg, rinfo) => {
      try {
        const name = `syslog:${rinfo.address}`;
        let source = db.prepare('SELECT * FROM sources WHERE name = ?').get(name);
        if (!source) {
          const color = COLORS[Math.floor(Math.random() * COLORS.length)];
          const info = db.prepare('INSERT INTO sources (name, api_key, color, created_at) VALUES (?, ?, ?, ?)')
            .run(name, genToken(), color, Date.now());
          source = db.prepare('SELECT * FROM sources WHERE id = ?').get(info.lastInsertRowid);
        }
        const line = parseSyslog(msg);
        ingestLines(source, [{ ...line, raw_json: null }]);
      } catch (e) { console.warn('[syslog]', e.message); }
    });
    syslogSocket.bind(syslogPort, () => console.log(`Syslog UDP listener on :${syslogPort}`));
    app.locals.syslogSocket = syslogSocket;
  }

  // ── session auth (admin UI) ────────────────────────────────────────────────
  app.use(express.json());

  function requireAuth(req, res, next) {
    const token = req.cookies[SESSION_COOKIE];
    if (token && db.prepare('SELECT id FROM sessions WHERE token = ?').get(token)) return next();
    res.status(401).json({ error: 'unauthorized' });
  }

  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'logbin' }));

  app.post('/api/login', (req, res) => {
    if ((req.body || {}).password !== adminPassword) return res.status(401).json({ error: 'wrong password' });
    const token = genSessionToken();
    db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(token, Date.now());
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax' });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  app.get('/auth/auto', (req, res) => {
    if (autologinToken && req.query.token === autologinToken) {
      const token = genSessionToken();
      db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(token, Date.now());
      res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax' });
    }
    res.redirect('/');
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true }));

  // ── sources ─────────────────────────────────────────────────────────────────
  app.get('/api/sources', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM sources ORDER BY name').all();
    res.json(rows.map((s) => ({
      ...s,
      line_count: db.prepare('SELECT COUNT(*) AS n FROM log_lines WHERE source_id = ?').get(s.id).n,
      last_line_at: db.prepare('SELECT MAX(received_at) AS t FROM log_lines WHERE source_id = ?').get(s.id).t
    })));
  });

  app.post('/api/sources', requireAuth, (req, res) => {
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const color = String((req.body || {}).color || COLORS[db.prepare('SELECT COUNT(*) AS n FROM sources').get().n % COLORS.length]);
    try {
      const info = db.prepare('INSERT INTO sources (name, api_key, color, retention_days, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(name, genToken(), color, Number((req.body || {}).retention_days) || 14, Date.now());
      res.status(201).json(db.prepare('SELECT * FROM sources WHERE id = ?').get(info.lastInsertRowid));
    } catch {
      res.status(409).json({ error: 'source name already exists' });
    }
  });

  app.put('/api/sources/:id', requireAuth, (req, res) => {
    const s = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    db.prepare('UPDATE sources SET name = ?, color = ?, retention_days = ? WHERE id = ?')
      .run(String(b.name || s.name).trim(), String(b.color || s.color), Math.max(0, Number(b.retention_days ?? s.retention_days)), s.id);
    res.json(db.prepare('SELECT * FROM sources WHERE id = ?').get(s.id));
  });

  app.delete('/api/sources/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM log_lines WHERE source_id = ?').run(req.params.id);
    db.prepare('DELETE FROM sources WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/sources/:id/rotate-key', requireAuth, (req, res) => {
    const key = genToken();
    db.prepare('UPDATE sources SET api_key = ? WHERE id = ?').run(key, req.params.id);
    res.json({ api_key: key });
  });

  // ── search / query ──────────────────────────────────────────────────────────
  app.get('/api/logs', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
    const clauses = [];
    const params = [];
    if (req.query.source_id) { clauses.push('l.source_id = ?'); params.push(Number(req.query.source_id)); }
    if (req.query.level) {
      const levels = String(req.query.level).split(',');
      clauses.push(`l.level IN (${levels.map(() => '?').join(',')})`);
      params.push(...levels);
    }
    if (req.query.q) { clauses.push('l.message LIKE ?'); params.push(`%${req.query.q}%`); }
    if (req.query.before) { clauses.push('l.id < ?'); params.push(Number(req.query.before)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT l.*, s.name AS source_name, s.color FROM log_lines l
      JOIN sources s ON s.id = l.source_id
      ${where} ORDER BY l.id DESC LIMIT ?
    `).all(...params, limit);
    res.json(rows.reverse());
  });

  // ── SSE live tail ───────────────────────────────────────────────────────────
  app.get('/api/tail', requireAuth, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write(': connected\n\n');
    const sourceId = req.query.source_id ? Number(req.query.source_id) : null;
    const levels = req.query.level ? String(req.query.level).split(',') : null;
    const q = req.query.q ? String(req.query.q).toLowerCase() : null;
    const onLine = (row) => {
      if (sourceId && row.source_id !== sourceId) return;
      if (levels && !levels.includes(row.level)) return;
      if (q && !row.message.toLowerCase().includes(q)) return;
      res.write(`data: ${JSON.stringify(row)}\n\n`);
    };
    bus.on('line', onLine);
    const ka = setInterval(() => res.write(': ka\n\n'), 25000);
    req.on('close', () => { bus.off('line', onLine); clearInterval(ka); });
  });

  // ── saved views ─────────────────────────────────────────────────────────────
  app.get('/api/views', requireAuth, (req, res) => res.json(db.prepare('SELECT * FROM saved_views ORDER BY name').all()));
  app.post('/api/views', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.query) return res.status(400).json({ error: 'name and query required' });
    const info = db.prepare('INSERT INTO saved_views (name, query_json, created_at) VALUES (?, ?, ?)')
      .run(String(b.name), JSON.stringify(b.query), Date.now());
    res.status(201).json(db.prepare('SELECT * FROM saved_views WHERE id = ?').get(info.lastInsertRowid));
  });
  app.delete('/api/views/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM saved_views WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── alert rules ─────────────────────────────────────────────────────────────
  app.get('/api/rules', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT r.*, s.name AS source_name FROM alert_rules r LEFT JOIN sources s ON s.id = r.source_id').all();
    res.json(rows);
  });
  app.post('/api/rules', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.pattern) return res.status(400).json({ error: 'name and pattern required' });
    try { new RegExp(b.pattern); } catch { return res.status(400).json({ error: 'invalid regex pattern' }); }
    const info = db.prepare(`
      INSERT INTO alert_rules (name, source_id, pattern, threshold, window_s, webhook_url, email)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(String(b.name), b.source_id || null, String(b.pattern), Math.max(1, Number(b.threshold) || 5),
           Math.max(10, Number(b.window_s) || 300), String(b.webhook_url || ''), String(b.email || ''));
    res.status(201).json(db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(info.lastInsertRowid));
  });
  app.put('/api/rules/:id', requireAuth, (req, res) => {
    const r = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    const b = { ...r, ...(req.body || {}) };
    db.prepare(`
      UPDATE alert_rules SET name = ?, source_id = ?, pattern = ?, threshold = ?, window_s = ?, webhook_url = ?, email = ?, enabled = ?
      WHERE id = ?
    `).run(b.name, b.source_id || null, b.pattern, b.threshold, b.window_s, b.webhook_url, b.email, b.enabled ? 1 : 0, r.id);
    res.json(db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(r.id));
  });
  app.delete('/api/rules/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM alert_events WHERE rule_id = ?').run(req.params.id);
    db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/alert-events', requireAuth, (req, res) => {
    res.json(db.prepare(`
      SELECT e.*, r.name AS rule_name FROM alert_events e LEFT JOIN alert_rules r ON r.id = e.rule_id
      ORDER BY e.fired_at DESC LIMIT 200
    `).all());
  });

  // ── maintenance ─────────────────────────────────────────────────────────────
  app.post('/api/purge', requireAuth, (req, res) => res.json({ ok: true, deleted: purge() }));

  app.get('/api/stats', requireAuth, (req, res) => {
    res.json({
      total_lines: db.prepare('SELECT COUNT(*) AS n FROM log_lines').get().n,
      last_hour: db.prepare('SELECT COUNT(*) AS n FROM log_lines WHERE received_at >= ?').get(Date.now() - 3600000).n,
      errors_last_hour: db.prepare("SELECT COUNT(*) AS n FROM log_lines WHERE level = 'error' AND received_at >= ?").get(Date.now() - 3600000).n
    });
  });

  // ── static frontend ─────────────────────────────────────────────────────────
  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ingest')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  return app;
}

module.exports = { createApp };
