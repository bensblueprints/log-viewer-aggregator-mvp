# Product Hunt — Logbin

**Name:** Logbin

**Tagline (60 chars):** Self-hosted log tail, search & alerts. $34 once, no meter.

**Description (260 chars):**
Logbin aggregates logs from all your servers: HTTP/syslog ingest, live tail in the browser (SSE), full-text search, per-source retention, and regex alert rules ("ERROR ≥5 in 5min → webhook"). Self-hosted on SQLite. Pay once instead of renting Papertrail.

**Full description:**
Log SaaS pricing has a dark secret: you pay the most on your worst day. One bad deploy, one error loop, and your metered bill spikes exactly when you're busiest.

Logbin is the flat-price alternative you host yourself:

- Ingest via HTTP POST (plaintext/JSON/NDJSON, levels auto-detected), syslog UDP (auto-creates sources per host), or the bundled tail-to-HTTP shipper scripts
- Live tail with source/level/text filters, pause, highlight
- Full-text search + saved views
- Alert rules: regex + threshold + window → webhook/email, with cooldowns
- Per-source retention keeps SQLite lean automatically
- API keys per source, rotatable; color-coded sources
- Docker on a $5 VPS or as a desktop app for local dev logs

**Maker first comment:**
Hey PH 👋 I got tired of log SaaS bills that scale with my outages — Papertrail's free tier is 50MB/day, which is one bad night of stack traces. Logbin is the boring, flat version: Node + SQLite (WAL, properly indexed), SSE live tail, LIKE search, syslog UDP listener, and alert rules with cooldowns so an error loop sends ONE webhook, not four hundred. $34 once, MIT source. Honest scope: this is for small teams and side projects, not a petabyte Elastic cluster — retention keeps SQLite happy at millions of rows. AMA!

**Gallery shots (5):**
1. Live tail — color-coded sources, red ERROR rows streaming, "live" indicator pulsing.
2. Search with highlighted matches + level filter chips.
3. Alert rules panel — "/ERROR|FATAL/i ≥5 in 300s → webhook, fired 22:14".
4. Sources panel — API keys, retention day inputs, one-line curl example.
5. Math card: "Metered log SaaS: pays most on your worst day. Logbin: $34, flat, forever."
