# Launch strategy — Logbin

## Target communities

- **r/selfhosted** — bullseye audience. Post: "Self-hosted Papertrail alternative — live tail, search, syslog, alerts, SQLite. MIT." Include the one-curl ingest demo GIF.
- **r/devops** — angle: metered log pricing punishes incidents. Lead with the "you pay most on your worst day" argument, tool second (sub dislikes drive-by promo).
- **r/homelab** — syslog UDP + auto-created sources is exactly what homelabbers want for routers/NAS boxes.
- **r/webdev / r/node** — the "tail -f for all your servers in one tab" framing; show the shipper script.
- **Hacker News** — see Show HN below.

## Show HN draft

**Title:** Show HN: Logbin – self-hosted log aggregator with live tail and alert rules ($34)

**Body:**
Metered log SaaS has a perverse incentive: your bill peaks during your outages. Papertrail's free tier (50MB/day) is one bad night of stack traces.

Logbin is the flat, boring alternative: Node + Express + SQLite (WAL, indexed on source/time/level), SSE live tail in a React UI, LIKE-based search with highlighting, a pragmatic RFC3164 syslog UDP listener that auto-creates sources per host, per-source retention that keeps SQLite lean, and alert rules — regex + threshold + window → webhook/email, with cooldowns so an error loop is one alert, not four hundred.

Ship logs with a single curl, the bundled tail-to-HTTP shipper (bash or Node, zero deps), or point syslog at it.

Honest scope: small teams and side projects, not Elastic. At that scale SQLite is genuinely great. MIT source.

## SEO keywords (10)

1. papertrail alternative self hosted
2. self hosted log aggregator
3. open source log viewer
4. syslog server web ui
5. live log tail browser
6. log management self hosted
7. log alerts webhook
8. lightweight log server sqlite
9. logtail alternative self hosted
10. log aggregation one time price

## AppSumo / PitchGround pitch

Logbin replaces metered log SaaS (Papertrail, Logtail/BetterStack) with a flat one-time purchase buyers host themselves. It aggregates logs from every server via HTTP or syslog, gives a browser live-tail with filters and full-text search, enforces per-source retention automatically, and fires webhook/email alerts on regex thresholds with cooldowns. The pricing story sells itself: metered log services bill hardest during incidents — the worst possible moment — while Logbin costs $34 exactly once, with volume limited only by the buyer's disk. Deploys via docker-compose in two minutes, doubles as a desktop app for local development logs, and the source is MIT.

## Pricing math

**$34 one-time.** Papertrail starts at $7/mo and climbs fast with volume → **Logbin pays for itself in under 5 months at the entry tier**, and in under a month against the ~$40/mo plans a real error volume forces you onto. Three years at even $10/mo average = $360 vs $34 once.
