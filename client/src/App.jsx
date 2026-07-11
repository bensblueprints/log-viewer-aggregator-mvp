import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Logs, Plus, Search, Pause, Play, Trash2, Bell, Copy, KeyRound, LogOut,
  RefreshCw, Bookmark, X, Settings2, Radio, Eraser
} from 'lucide-react';
import { api, tailStream } from './api.js';

const LEVEL_COLORS = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-zinc-300',
  debug: 'text-zinc-500'
};
const LEVELS = ['error', 'warn', 'info', 'debug'];

function Login({ onOk }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try { await api.login(pw); onOk(); } catch (x) { setErr(x.message); }
        }}>
        <div className="flex items-center gap-3">
          <div className="bg-orange-600/20 border border-orange-500/30 rounded-xl p-2.5"><Logs className="text-orange-400" size={22} /></div>
          <div>
            <h1 className="text-lg font-semibold">Logbin</h1>
            <p className="text-xs text-zinc-500">Your logs. Your box. Flat price.</p>
          </div>
        </div>
        <input type="password" placeholder="admin password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button className="btn-primary w-full justify-center">Sign in</button>
      </motion.form>
    </div>
  );
}

function highlight(message, q) {
  if (!q) return message;
  try {
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = message.split(re);
    return parts.map((p, i) => (re.test(p) && i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
  } catch {
    return message;
  }
}

export default function App() {
  const [phase, setPhase] = useState('loading');
  const [sources, setSources] = useState([]);
  const [rules, setRules] = useState([]);
  const [views, setViews] = useState([]);
  const [stats, setStats] = useState(null);
  const [lines, setLines] = useState([]);
  const [filter, setFilter] = useState({ source_id: '', level: '', q: '' });
  const [live, setLive] = useState(true);
  const [panel, setPanel] = useState(null); // null|sources|rules
  const [toast, setToast] = useState('');
  const bottomRef = useRef(null);
  const stopTail = useRef(null);

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const loadMeta = useCallback(() => {
    api.sources().then(setSources);
    api.rules().then(setRules);
    api.views().then(setViews);
    api.stats().then(setStats);
  }, []);

  useEffect(() => {
    api.me().then(() => { setPhase('app'); loadMeta(); }).catch(() => setPhase('login'));
  }, [loadMeta]);

  // (re)load history + (re)subscribe tail when filters change
  useEffect(() => {
    if (phase !== 'app') return;
    let cancelled = false;
    api.logs({ ...filter, limit: 300 }).then((rows) => { if (!cancelled) setLines(rows); });
    if (stopTail.current) stopTail.current();
    if (live) {
      stopTail.current = tailStream(filter, (row) => {
        setLines((xs) => [...xs.slice(-999), row]);
      });
    }
    return () => { cancelled = true; if (stopTail.current) stopTail.current(); };
  }, [phase, filter, live]);

  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [lines, live]);

  if (phase === 'loading') return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="animate-spin text-zinc-600" /></div>;
  if (phase === 'login') return <Login onOk={() => { setPhase('app'); loadMeta(); }} />;

  const levelSet = filter.level ? filter.level.split(',') : [];

  return (
    <div className="min-h-screen flex flex-col max-w-[1500px] mx-auto p-4 gap-3">
      <header className="flex items-center gap-3 flex-wrap">
        <div className="bg-orange-600/20 border border-orange-500/30 rounded-xl p-2"><Logs className="text-orange-400" size={18} /></div>
        <h1 className="font-semibold">Logbin</h1>
        {stats && <span className="text-xs text-zinc-500">{stats.total_lines.toLocaleString()} lines · {stats.last_hour}/h · <span className="text-red-400">{stats.errors_last_hour} err/h</span></span>}
        <div className="flex-1" />
        <button className={`btn-ghost ${panel === 'sources' ? 'border-orange-700!' : ''}`} onClick={() => setPanel(panel === 'sources' ? null : 'sources')}><Settings2 size={14} /> Sources</button>
        <button className={`btn-ghost ${panel === 'rules' ? 'border-orange-700!' : ''}`} onClick={() => setPanel(panel === 'rules' ? null : 'rules')}><Bell size={14} /> Alerts</button>
        <button className="btn-ghost" onClick={async () => { await api.logout(); setPhase('login'); }}><LogOut size={14} /></button>
      </header>

      {/* filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
          <input className="pl-8!" placeholder="Search messages… (highlight supports the same text)"
            value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        </div>
        <select className="w-44!" value={filter.source_id} onChange={(e) => setFilter({ ...filter, source_id: e.target.value })}>
          <option value="">all sources</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {LEVELS.map((l) => (
          <button key={l}
            className={`px-2.5 py-1.5 rounded-lg text-xs border ${levelSet.includes(l) ? 'border-orange-600 text-orange-300 bg-orange-600/10' : 'border-zinc-800 text-zinc-500 bg-zinc-900'}`}
            onClick={() => {
              const next = levelSet.includes(l) ? levelSet.filter((x) => x !== l) : [...levelSet, l];
              setFilter({ ...filter, level: next.join(',') });
            }}>{l}</button>
        ))}
        <button className={`btn-ghost ${live ? 'text-emerald-400!' : ''}`} onClick={() => setLive(!live)}>
          {live ? <><Radio size={14} className="animate-pulse" /> live</> : <><Pause size={14} /> paused</>}
        </button>
        <button className="btn-ghost" title="Save this filter as a view" onClick={async () => {
          const name = prompt('View name:');
          if (name) { await api.saveView(name, filter); setViews(await api.views()); }
        }}><Bookmark size={14} /></button>
        {views.map((v) => (
          <button key={v.id} className="text-xs text-zinc-400 hover:text-orange-300 border border-zinc-800 rounded-lg px-2 py-1.5 group"
            onClick={() => setFilter(JSON.parse(v.query_json))}>
            {v.name}
            <span className="text-zinc-600 hover:text-red-400 ml-1.5" onClick={async (e) => {
              e.stopPropagation();
              await api.deleteView(v.id);
              setViews(await api.views());
            }}>×</span>
          </button>
        ))}
      </div>

      {/* panels */}
      <AnimatePresence>
        {panel === 'sources' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="text-sm text-zinc-400">Sources & API keys</h3>
                <div className="flex gap-2">
                  <button className="btn-ghost text-xs!" onClick={async () => { const r = await api.purge(); say(`Purged ${r.deleted} old lines`); loadMeta(); }}><Eraser size={13} /> Run retention purge</button>
                  <button className="btn-primary" onClick={async () => {
                    const name = prompt('Source name (e.g. api-server):');
                    if (name) { await api.createSource({ name }); loadMeta(); }
                  }}><Plus size={14} /> Add source</button>
                </div>
              </div>
              {sources.map((s) => (
                <div key={s.id} className="flex items-center gap-3 text-sm bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2 flex-wrap">
                  <input type="color" className="w-7! h-7 p-0.5!" value={s.color} onChange={async (e) => { await api.updateSource(s.id, { color: e.target.value }); loadMeta(); }} />
                  <input className="w-40!" defaultValue={s.name} onBlur={async (e) => { if (e.target.value !== s.name) { await api.updateSource(s.id, { name: e.target.value }); loadMeta(); } }} />
                  <code className="mono text-xs text-zinc-500 flex-1 truncate">{s.api_key}</code>
                  <button className="btn-ghost px-2! py-1!" title="Copy key" onClick={() => { navigator.clipboard.writeText(s.api_key); say('API key copied'); }}><Copy size={12} /></button>
                  <button className="btn-ghost px-2! py-1!" title="Rotate key" onClick={async () => { await api.rotateKey(s.id); loadMeta(); say('Key rotated'); }}><KeyRound size={12} /></button>
                  <label className="text-xs text-zinc-500">keep
                    <input type="number" className="w-16! mx-1 inline-block" defaultValue={s.retention_days}
                      onBlur={async (e) => { await api.updateSource(s.id, { retention_days: e.target.value }); say('Retention updated'); }} /> days
                  </label>
                  <span className="text-xs text-zinc-600">{s.line_count.toLocaleString()} lines</span>
                  <button className="btn-danger px-2! py-1!" onClick={async () => {
                    if (confirm(`Delete source ${s.name} and all its lines?`)) { await api.deleteSource(s.id); loadMeta(); }
                  }}><Trash2 size={12} /></button>
                </div>
              ))}
              <p className="text-xs text-zinc-600 mono">
                curl -X POST {location.origin}/ingest -H "X-Api-Key: &lt;key&gt;" --data-binary "ERROR something broke" · syslog UDP on :5514 auto-creates sources
              </p>
            </div>
          </motion.div>
        )}

        {panel === 'rules' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="text-sm text-zinc-400">Alert rules — "if pattern matches ≥ N times in M seconds"</h3>
                <button className="btn-primary" onClick={async () => {
                  const name = prompt('Rule name:', 'Error burst');
                  if (!name) return;
                  const pattern = prompt('Regex pattern:', 'ERROR|FATAL');
                  if (!pattern) return;
                  const threshold = Number(prompt('Fire when matches ≥', '5')) || 5;
                  const window_s = Number(prompt('…within seconds:', '300')) || 300;
                  const webhook_url = prompt('Webhook URL (blank = none):') || '';
                  const email = prompt('Alert email (blank = none, needs SMTP):') || '';
                  await api.createRule({ name, pattern, threshold, window_s, webhook_url, email });
                  loadMeta();
                }}><Plus size={14} /> Add rule</button>
              </div>
              {rules.map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-sm bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
                  <button className={`w-2.5 h-2.5 rounded-full ${r.enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`} title="Toggle"
                    onClick={async () => { await api.updateRule(r.id, { enabled: !r.enabled }); loadMeta(); }} />
                  <span className="font-medium">{r.name}</span>
                  <code className="mono text-xs text-orange-300">/{r.pattern}/i</code>
                  <span className="text-xs text-zinc-500">≥{r.threshold} in {r.window_s}s · {r.source_name || 'all sources'}</span>
                  <span className="text-xs text-zinc-600 flex-1">{r.webhook_url ? 'webhook' : ''} {r.email ? 'email' : ''}</span>
                  {r.last_fired_at && <span className="text-xs text-amber-400">fired {new Date(r.last_fired_at).toLocaleTimeString()}</span>}
                  <button className="btn-danger px-2! py-1!" onClick={async () => { await api.deleteRule(r.id); loadMeta(); }}><Trash2 size={12} /></button>
                </div>
              ))}
              {rules.length === 0 && <p className="text-xs text-zinc-600">No rules yet. Example: pattern <code>ERROR|FATAL</code>, ≥5 matches in 300s → webhook.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* log stream */}
      <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-y-auto min-h-96 mono text-[13px] leading-relaxed p-3">
        {lines.map((l) => (
          <div key={l.id} className="flex gap-2 hover:bg-zinc-900/70 rounded px-1 items-baseline">
            <span className="text-zinc-600 shrink-0 text-[11px] w-[74px]">{new Date(l.received_at).toLocaleTimeString()}</span>
            <span className="shrink-0 text-[11px] px-1.5 rounded" style={{ color: l.color, background: `${l.color}18` }}>{l.source_name}</span>
            <span className={`shrink-0 w-12 text-[11px] uppercase ${LEVEL_COLORS[l.level] || 'text-zinc-400'}`}>{l.level}</span>
            <span className={`whitespace-pre-wrap break-all ${l.level === 'error' ? 'text-red-200' : ''}`}>{highlight(l.message, filter.q)}</span>
          </div>
        ))}
        {lines.length === 0 && (
          <div className="text-center text-zinc-600 py-20 font-sans">
            No log lines match. Ship something:<br />
            <code className="text-xs">curl -X POST {location.origin}/ingest -H "X-Api-Key: ..." --data-binary "hello logbin"</code>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 rounded-full px-4 py-2 text-sm shadow-xl font-sans">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
