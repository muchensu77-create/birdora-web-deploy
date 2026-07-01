# Changelog

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
