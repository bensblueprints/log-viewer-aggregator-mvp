# 🪵 Logbin

**Self-hosted log aggregation with live tail, search, and alert rules. Flat price, your box, forever — no Papertrail meter running.**

![MIT](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

Papertrail's free tier is 50MB/day — one bad night of stack traces and you're on a paid plan that scales with your worst outage. Logbin is the pay-once alternative: ship logs from any server over HTTP or syslog, tail them live in a web UI, search everything, and get alerted when `ERROR` starts screaming.

![screenshot](docs/screenshot.png)

## Features

- 📥 **Ingest anything** — `POST /ingest` takes plaintext, JSON, arrays, or NDJSON (levels auto-detected); a syslog UDP listener auto-creates sources per host; two tiny shipper scripts (`shipper/shipper.sh`, `shipper/shipper.js`) tail files → HTTP.
- 📡 **Live tail** — SSE stream with source/level filters and text matching; pause/resume; auto-scroll.
- 🔎 **Search & filter** — full-text search with match highlighting, per-source and per-level filters, saved views.
- 🚨 **Alert rules** — "if `/ERROR|FATAL/` matches ≥ N times in M seconds → webhook/email", with cooldowns so one incident is one alert.
- 🗄 **Per-source retention** — auto-purge old rows (default 14 days) to keep SQLite lean; API keys per source, rotatable; color-coded sources.
- 🖥 **Desktop mode or VPS** — Electron app for local dev-log tailing, Docker for the real thing.

## Quick start

```bash
npm i
npm run build
npm start          # → http://localhost:5347 (syslog UDP on :5514)
```

Ship your first line:

```bash
curl -X POST http://localhost:5347/ingest \
  -H "X-Api-Key: <source key from the UI>" \
  --data-binary "ERROR something broke"
```

**Run it as a desktop app, or deploy to a $5 VPS when you need it public:**

```bash
npm run desktop
# or
docker compose up -d
```

## Logbin vs Papertrail

| | Logbin | Papertrail |
|---|---|---|
| Price | **$34 once** | $7/mo → $100s as volume grows |
| Volume limits | your disk | metered (50MB/day free) |
| Retention | you choose, per source | tier-dependent |
| Live tail | ✅ SSE | ✅ |
| Search | ✅ | ✅ |
| Alerts (regex + threshold) | ✅ webhook/email | ✅ |
| Syslog + HTTP + shippers | ✅ | ✅ |
| Logs leave your infrastructure | never | always |

## Honest limitations

- SQLite comfortably handles small-team volumes (millions of rows with retention doing its job) — this is not a Elasticsearch cluster and doesn't pretend to be.
- Search is `LIKE`-based (with regex highlighting client-side), not a full-text index.
- Syslog listener speaks pragmatic RFC3164 (priority + message) over UDP.

## Tech stack

Node 20+ · Express · better-sqlite3 (WAL, indexed on source+time+level) · SSE · `dgram` syslog · React + Vite + Tailwind + Framer Motion + Lucide · nodemailer · Electron desktop wrapper.

## ☕ Skip the setup — get the 1-click installer

Grab the packaged version: **[https://whop.com/benjisaiempire/logbin](https://whop.com/benjisaiempire/logbin)** — pay once, own it forever, no subscription.

## License

MIT © 2026 Ben (bensblueprints)
