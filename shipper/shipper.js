#!/usr/bin/env node
// Logbin shipper — tails a file (cross-platform, no deps) and POSTs new lines
// in small batches. Usage:
//   LOGBIN_URL=http://box:5347 LOGBIN_KEY=lb_xxx node shipper.js /var/log/app.log
const fs = require('fs');

const file = process.argv[2];
const URL_BASE = process.env.LOGBIN_URL;
const KEY = process.env.LOGBIN_KEY;
if (!file || !URL_BASE || !KEY) {
  console.error('usage: LOGBIN_URL=... LOGBIN_KEY=... node shipper.js <logfile>');
  process.exit(1);
}

let pos = fs.existsSync(file) ? fs.statSync(file).size : 0;
let buffer = [];
let leftovers = '';

async function flush() {
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await fetch(`${URL_BASE.replace(/\/$/, '')}/ingest`, {
      method: 'POST',
      headers: { 'X-Api-Key': KEY, 'Content-Type': 'text/plain' },
      body: batch.join('\n')
    });
  } catch (e) {
    console.error('ship failed:', e.message);
    buffer.unshift(...batch); // retry next flush
  }
}

function poll() {
  fs.stat(file, (err, st) => {
    if (err) return;
    if (st.size < pos) pos = 0; // rotated
    if (st.size > pos) {
      const stream = fs.createReadStream(file, { start: pos, end: st.size - 1, encoding: 'utf8' });
      let chunked = '';
      stream.on('data', (d) => (chunked += d));
      stream.on('end', () => {
        pos = st.size;
        const text = leftovers + chunked;
        const lines = text.split(/\r?\n/);
        leftovers = lines.pop() || '';
        buffer.push(...lines.filter((l) => l.trim()));
      });
    }
  });
}

console.error(`shipping ${file} → ${URL_BASE}/ingest`);
setInterval(poll, 1000);
setInterval(flush, 2000);
