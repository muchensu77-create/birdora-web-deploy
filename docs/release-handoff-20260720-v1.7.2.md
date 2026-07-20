# Birdora v1.7.2 Release Handoff

## Goal

Validate that the production architecture can support a 50-person peak for account registration/login, bird-image recognition, observation save/refresh, community publishing/comments, and stable UI reactions without touching production data during load testing.

## Implemented

- Updated the API peak suite to use the production canonical draft and idempotent publish contract while keeping the legacy publish/edit feature flags disabled.
- Updated browser automation for the current standalone registration page, HttpOnly cookie authentication, recognition page, observation refresh page, canonical publishing, and detail-comment UI.
- Added retry recovery for transient page-script loading failures and direct localhost connections that bypass operating-system proxies.
- Added controlled browser concurrency so 50 distinct journeys can be verified without confusing load-generator exhaustion with server capacity.
- Added a core load-harness contract test so route, safety, diagnostic, and production-flag assumptions cannot silently regress.

## Evidence

- API peak: 1518/1518 successful requests; 0 failures, 0 5xx, 0 429, 0 timeout; API p95 827ms.
- API business flows: 50/50 active sessions, 50/50 observation save/refresh, 50/50 canonical community publications.
- Browser journeys: 50/50 passed at maximum 5 concurrent Chrome clients.
- Every browser phase passed 50/50: register, logout, login, recognition, observation save/refresh, publish, UI comment.
- Browser diagnostics: 0 console errors, 0 warnings, 0 runtime exceptions, 0 network failures, 0 API network failures, 0 crashes.
- Real browser recognition: 50/50 Common Kingfisher; inference p95 12.467s under the controlled client load.
- Production community visual read-only check: desktop and 390x844 mobile layouts have no document horizontal overflow and no console warnings/errors.

## Production Safety

- All write/load tests used isolated SQLite and isolated upload directories on `D:`.
- Production receives no load-test accounts, observations, posts, comments, or images.
- Deployment must preserve `/var/lib/birdora/birdora.sqlite`, verify its pre/post byte identity when no migration is required, and retain an application/data rollback point.
- Only Birdora API/static processes may be restarted. Unrelated PM2 services must keep their PIDs.
- Post-deployment verification is read-only.

## Maintenance Commands

```powershell
pnpm test:load-contracts
pnpm test

$env:BIRDORA_BROWSER_MAX_CONCURRENCY="5"
powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 run-50-pages -ExpectedCount 50
```

Do not run write load tests against production.
