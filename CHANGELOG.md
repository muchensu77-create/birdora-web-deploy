# Changelog

## 1.6.0 - 2026-07-03

- Added server-side OSEA recognition with `onnxruntime-node`, JPEG preprocessing, Top 5 output mapping, and `/api/recognition/classify`.
- Added HEIC conversion support and browser recognition compatibility assets for public/static delivery.
- Added password hashing/verification worker pooling to reduce auth register/login tail latency under concurrent tests.
- Added large-image upload validation and reporting for 50 community plus 50 observation uploads, with image-write metric hooks.
- Added 50-sub-agent browser flow reports and recognition ramp reports covering desktop and mobile real-browser recognition.
- Added safety tooling for write tests, browser flow harnesses, recognition server tests, and large-image tests.
- Updated performance reporting to `passed`: 1514/1514 requests succeeded, 0 5xx, 0 429, 0 timeouts, and API p95 threshold passed.
- Ignored raw per-agent browser result directories while keeping summary reports in version control.

## 1.5.1 - 2026-07-02

- Fixed production `.mjs` MIME handling for ONNX Runtime dynamic imports and added no-cache/stale request regression checks.
- Added Birdora favicon coverage across root and public pages, plus SVG MIME support for local static and Nginx delivery.
- Improved recognition loading visuals and community publish image-picker responsiveness across mobile, tablet, and desktop.
- Added `docs/release-handoff-20260702-v1.5.1.md` with validation, deployment boundary, and production-readonly notes.

## 1.5.0 - 2026-07-02

- Added authenticated observation records for saved recognition results, including image storage, Top 5 candidate snapshots, owner-only reads, and deletion rules.
- Added frontend observation history, save-recognition flow, and community posting linked to saved observations.
- Added `observation-api.js` to the public sync allowlist and wired observation APIs into the Express app.
- Added Origin write protection, request IDs, structured error logging, and sensitive log redaction.
- Added comment pagination, comment deletion, detail views, and observation-aware community cards.
- Raised account password minimum length to 8 characters and updated auth tests accordingly.
- Added 50-concurrency performance test planning, JSON/Markdown reports, and load-test cleanup tooling.
- Documented a performance finding: the load test completed without 5xx/timeouts, but the aggregate API p95 threshold is not yet green because auth register/login tail latency remains high.

## 1.4.0 - 2026-07-02

- Added the 2026-07-02 launch-readiness release handoff with version, collaboration, validation, and remaining-risk notes.
- Added agent collaboration rules through `AGENTS.md` and connected the latest handoff documents for future threads.
- Added launch readiness detection and execution reports for the 2026-07-03 50-person light-use target.
- Hardened community post media, interaction, pagination, copy-analysis, and owner-management paths across API and frontend surfaces.
- Added browser, community, peak, and production-readonly test entry points to make release checks repeatable.
- Updated Docker, Compose, Nginx, deployment, and README notes for community API data, uploads, health checks, and production guardrails.

## 1.3.0 - 2026-07-01

- Persisted community posts in server-side SQLite and bound every post to its authenticated account.
- Added public community visibility so authors can see their own posts together with everyone else's posts.
- Added community post images, reactions, comments, and questions backed by SQLite.
- Added persisted lightweight copy analysis with score, summary, tags, and suggestions.
- Added paginated community listing with `limit` / `offset` and a frontend load-more path.
- Added owner-only editing and deletion with server-enforced authorization.
- Added validation for uploaded image bytes, community write rate limiting, and delete-time image cleanup.
- Added `test:community` and `test:peak` coverage for the community flow, copy analysis, image reads, and 50-user lightweight API rehearsal.
- Split the community feature into API, card UI, route, controller, and service components.
- Added Docker and Compose configuration with a persistent data volume for containerized development.
- Documented that independent AI copy rewriting / moderation is not implemented yet.

## 1.2.0 - 2026-07-01

- Added touch-device auto scrolling for the bird atlas marquee.
- Improved mobile atlas scrolling with contained overscroll, touch momentum, hidden scrollbars, and scroll snapping while users interact.
- Kept duplicated marquee tracks available on mobile so looped scrolling can continue smoothly.

## 1.1.0 - 2026-06-30

- Added crow entries to the bird atlas data and synchronized public assets.
- Refined the atlas marquee experience with slower motion, mobile card sizing, hover/focus/touch pause handling, and hidden default entries where needed.
- Added UI accessibility audit screenshots and metrics for the 2026-06-30 stability pass.
- Added the stability repair master plan for follow-up release hardening work.
