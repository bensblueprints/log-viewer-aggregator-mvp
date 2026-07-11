async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body != null ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req('/api/me'),
  login: (password) => req('/api/login', { method: 'POST', body: { password } }),
  logout: () => req('/api/logout', { method: 'POST' }),
  sources: () => req('/api/sources'),
  createSource: (body) => req('/api/sources', { method: 'POST', body }),
  updateSource: (id, body) => req(`/api/sources/${id}`, { method: 'PUT', body }),
  deleteSource: (id) => req(`/api/sources/${id}`, { method: 'DELETE' }),
  rotateKey: (id) => req(`/api/sources/${id}/rotate-key`, { method: 'POST' }),
  logs: (params) => req(`/api/logs?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)))}`),
  views: () => req('/api/views'),
  saveView: (name, query) => req('/api/views', { method: 'POST', body: { name, query } }),
  deleteView: (id) => req(`/api/views/${id}`, { method: 'DELETE' }),
  rules: () => req('/api/rules'),
  createRule: (body) => req('/api/rules', { method: 'POST', body }),
  updateRule: (id, body) => req(`/api/rules/${id}`, { method: 'PUT', body }),
  deleteRule: (id) => req(`/api/rules/${id}`, { method: 'DELETE' }),
  alertEvents: () => req('/api/alert-events'),
  stats: () => req('/api/stats'),
  purge: () => req('/api/purge', { method: 'POST' })
};

export function tailStream(params, onLine) {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
  const es = new EventSource(`/api/tail?${qs}`);
  es.onmessage = (ev) => onLine(JSON.parse(ev.data));
  return () => es.close();
}
