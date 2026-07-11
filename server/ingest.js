// Line parsing + level detection for JSON lines, plaintext, and syslog.
const LEVELS = ['debug', 'info', 'warn', 'error'];

function normLevel(l) {
  const s = String(l || '').toLowerCase();
  if (s.startsWith('warn')) return 'warn';
  if (['err', 'error', 'fatal', 'crit', 'critical', 'alert', 'emerg'].some((x) => s.startsWith(x))) return 'error';
  if (s.startsWith('debug') || s === 'trace' || s === 'verbose') return 'debug';
  if (LEVELS.includes(s)) return s;
  return null;
}

function detectLevel(text) {
  const m = String(text).match(/\b(FATAL|CRITICAL|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i);
  return (m && normLevel(m[1])) || 'info';
}

// Accepts: single JSON object, JSON array, NDJSON, or plaintext lines.
// Returns [{level, message, raw_json}]
function parseBody(body, contentType = '') {
  const text = String(body || '').trim();
  if (!text) return [];

  const fromObj = (o) => {
    if (o == null || typeof o !== 'object') return { level: detectLevel(String(o)), message: String(o), raw_json: null };
    const message = String(o.message ?? o.msg ?? o.log ?? o.text ?? JSON.stringify(o));
    const level = normLevel(o.level ?? o.severity ?? o.lvl) || detectLevel(message);
    return { level, message, raw_json: JSON.stringify(o) };
  };

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(fromObj) : [fromObj(parsed)];
    } catch { /* fall through to line-by-line */ }
  }

  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const t = line.trim();
    if (t.startsWith('{')) {
      try { return fromObj(JSON.parse(t)); } catch { /* plaintext */ }
    }
    return { level: detectLevel(t), message: t, raw_json: null };
  });
}

// RFC3164-ish: <PRI>rest  — severity = PRI % 8
function parseSyslog(msg) {
  const text = msg.toString('utf8').trim();
  const m = text.match(/^<(\d{1,3})>\s*(.*)$/s);
  if (!m) return { level: detectLevel(text), message: text };
  const severity = Number(m[1]) % 8;
  const level = severity <= 3 ? 'error' : severity === 4 ? 'warn' : severity === 7 ? 'debug' : 'info';
  return { level, message: m[2].trim() || text };
}

module.exports = { parseBody, parseSyslog, detectLevel, normLevel, LEVELS };
