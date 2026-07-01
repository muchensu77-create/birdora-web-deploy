# Changelog

## 1.3.0 - 2026-07-01

- Persisted community posts in server-side SQLite and bound every post to its authenticated account.
- Added public community visibility so authors can see their own posts together with everyone else's posts.
- Added owner-only editing and deletion with server-enforced authorization.
- Split the community feature into API, card UI, route, controller, and service components.
- Added Docker and Compose configuration with a persistent data volume for containerized development.

## 1.2.0 - 2026-07-01

- Added touch-device auto scrolling for the bird atlas marquee.
- Improved mobile atlas scrolling with contained overscroll, touch momentum, hidden scrollbars, and scroll snapping while users interact.
- Kept duplicated marquee tracks available on mobile so looped scrolling can continue smoothly.

## 1.1.0 - 2026-06-30

- Added crow entries to the bird atlas data and synchronized public assets.
- Refined the atlas marquee experience with slower motion, mobile card sizing, hover/focus/touch pause handling, and hidden default entries where needed.
- Added UI accessibility audit screenshots and metrics for the 2026-06-30 stability pass.
- Added the stability repair master plan for follow-up release hardening work.
