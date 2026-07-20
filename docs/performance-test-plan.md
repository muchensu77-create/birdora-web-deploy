# Birdora 50-User Capacity And Browser Journey Test Plan

## Scope

This plan separates server capacity from client-device capacity:

- the API suite applies a true 50-session peak to registration, authentication, observations, community writes/reads, comments, and static/model downloads;
- the browser suite runs 50 distinct real Chrome journeys with controlled browser concurrency, because OSEA inference runs on each client device rather than on the server;
- browser diagnostics are a release gate: console errors, warnings, runtime exceptions, API network failures, and crashes must all be zero.

Do not run write load tests against production. Production checks must stay read-only.

## Safety Rules

Write load tests must use an isolated database and isolated upload directories.

Required safety variables for write scenarios:

```bash
DATABASE_FILE=app/data/load-test.sqlite
COMMUNITY_UPLOAD_DIR=app/data/load-test-uploads/community
OBSERVATION_UPLOAD_DIR=app/data/load-test-uploads/observations
```

The script refuses write load tests unless these paths include `load-test`, `staging`, or `test`.

Remote write targets are refused unless `ALLOW_REMOTE_LOAD_TEST=1` is set for an isolated staging target.

All generated data uses this prefix:

```text
loadtest-d-<runId>
```

Default `TEST_ORIGIN`:

```text
http://127.0.0.1:4174
```

## Environment Variables

```text
API_BASE_URL                 API target, defaults to AUTH_BASE_URL or http://127.0.0.1:4000
AUTH_BASE_URL                Backward-compatible API target
WEB_BASE_URL                 Static site target, defaults to http://127.0.0.1:4174
TEST_ORIGIN                  Legal write Origin, defaults to http://127.0.0.1:4174
DATABASE_FILE                Required isolated write-test SQLite path
COMMUNITY_UPLOAD_DIR         Required isolated community upload path
OBSERVATION_UPLOAD_DIR       Required isolated observation upload path
PEAK_USERS                   Defaults to 50
RUN_ID                       Defaults to loadtest-d-<timestamp>
LOAD_TEST_DURATION_SECONDS   Reserved for longer read loops; default one pass
LOAD_TEST_TIMEOUT_MS         Defaults to 15000
ALLOW_REMOTE_LOAD_TEST       Must be 1 for isolated remote staging writes
```

## Local Run Command

PowerShell:

```powershell
$env:DATABASE_FILE="app/data/load-test.sqlite"
$env:COMMUNITY_UPLOAD_DIR="app/data/load-test-uploads/community"
$env:OBSERVATION_UPLOAD_DIR="app/data/load-test-uploads/observations"
$env:PEAK_USERS="50"
$env:TEST_ORIGIN="http://127.0.0.1:4174"
$env:API_BASE_URL="http://127.0.0.1:4000"
$env:WEB_BASE_URL="http://127.0.0.1:4174"
node scripts/test-peak.js
```

Bash:

```bash
DATABASE_FILE=app/data/load-test.sqlite \
COMMUNITY_UPLOAD_DIR=app/data/load-test-uploads/community \
OBSERVATION_UPLOAD_DIR=app/data/load-test-uploads/observations \
PEAK_USERS=50 \
TEST_ORIGIN=http://127.0.0.1:4174 \
API_BASE_URL=http://127.0.0.1:4000 \
WEB_BASE_URL=http://127.0.0.1:4174 \
node scripts/test-peak.js
```

## Scenarios

### Scenario A: Static Resources

50 visitors request:

- `/`
- `/styles.css`
- `/script.js`
- `/community-api.js`
- `/observation-api.js`
- `/assets/hero-birdora.png`

No ONNX inference is triggered.

Thresholds:

- 5xx = 0
- non-image p95 < 1000ms
- image p95 < 1500ms

### Scenario B: Community Readonly

50 users request:

- `GET /api/community/posts`
- `GET /api/community/posts/:id`
- `GET /api/community/posts/:id/comments`
- `GET /api/community/posts/:id/image`

Missing image 404 is classified as an expected business result when no test post image exists.

### Scenario C: Login And Session

50 users register and login with:

```text
loadtest-d-<runId>-user-<n>@example.test
```

Requests:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/status`
- `GET /api/auth/me`
- `POST /api/auth/logout`

429 is reported separately from 5xx.

### Scenario D: Observation Save Loop

50 logged-in users create one observation each with Top 5 candidates and a tiny generated PNG data URL.

Requests:

- `POST /api/observations`
- `GET /api/observations/me`
- `GET /api/observations/:id`
- `GET /api/observations/:id/image`

The script also checks:

- bad Origin returns 403
- another user cannot read the observation image

### Scenario E: Community Write Loop

50 users create canonical drafts and publish them, some linked to their own observation. They also like, comment, ask questions, delete their own comments, and delete their own posts. The legacy publish/edit flags remain disabled, matching production.

Requests:

- `POST /api/v1/drafts`
- `POST /api/v1/drafts/:id/publish`
- `PUT /api/v1/posts/:id/like`
- `POST /api/community/posts/:id/comments`
- `DELETE /api/community/posts/:postId/comments/:commentId`
- `POST /api/community/posts/:id/questions`
- `DELETE /api/community/posts/:id`

Bad-Origin comment delete must return 403.

### Scenario F: Model Static Downloads

50 visitors download static model resources:

- `/assets/osea/bird_model.onnx`
- `/assets/vendor/ort-wasm-simd-threaded.wasm`
- `/assets/osea/bird_info.json`

This download scenario is complemented by the browser journey suite below, which performs real OSEA inference for all 50 user journeys.

### Browser Journey Suite

Each of 50 independent Chrome profiles performs:

1. register through `register.html`;
2. log out from the profile UI and log back in;
3. upload the kingfisher sample on `explore.html` and run real browser-side OSEA inference;
4. save the recognized observation and verify it again after navigating to the observation list;
5. create a canonical draft and publish it with an idempotency key;
6. open the post detail UI, submit a comment through the visible controls, and verify it renders.

Use `BIRDORA_BROWSER_MAX_CONCURRENCY` to keep client-side Chrome pressure within the load generator's hardware capacity. This does not reduce the API suite's 50-session peak. A release report must state the selected browser concurrency explicitly.

Required browser gate:

- 50/50 user journeys pass every phase;
- recognition succeeds 50/50;
- console errors, warnings, runtime exceptions, API network failures, and crashes are all zero.

### Scenario G: Image Boundary Checks

The script verifies:

- legal tiny community image succeeds
- legal tiny observation image succeeds
- invalid MIME returns 400
- wrong data URL content returns 400
- dynamically generated over-limit image returns 400

No large image file is added to the repository.

## Reports

`scripts/test-peak.js` writes:

- `docs/performance-report.md`
- `docs/performance-report.json`

The Markdown report includes environment, isolation checks, scenario summaries, endpoint summaries, validation status, 4xx/5xx classification, request id samples, bottleneck judgment, and cleanup commands.

The JSON report includes raw request records for later comparison.

The browser suite writes:

- `docs/browser-50-agent-flow-report.md`
- `docs/browser-50-agent-flow-report.json`

## Cleanup

Dry run:

```bash
DATABASE_FILE=app/data/load-test.sqlite \
COMMUNITY_UPLOAD_DIR=app/data/load-test-uploads/community \
OBSERVATION_UPLOAD_DIR=app/data/load-test-uploads/observations \
node scripts/cleanup-load-test-data.js --runId loadtest-d-<runId>
```

Apply cleanup:

```bash
DATABASE_FILE=app/data/load-test.sqlite \
COMMUNITY_UPLOAD_DIR=app/data/load-test-uploads/community \
OBSERVATION_UPLOAD_DIR=app/data/load-test-uploads/observations \
node scripts/cleanup-load-test-data.js --runId loadtest-d-<runId> --yes
```

The cleanup script refuses non-`loadtest-d-*` prefixes and refuses database/upload paths that do not look isolated.
