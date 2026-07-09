# Birdora Thread D1 Performance Test Plan

## Scope

This plan covers the first Node-based 50-concurrency load test pass. It does not introduce k6, autocannon, wrk, Lighthouse, Playwright, or any business-code changes.

Allowed files for this round:

- `scripts/test-peak.js`
- `scripts/cleanup-load-test-data.js`
- `docs/performance-test-plan.md`
- `docs/performance-report.md`
- `docs/performance-report.json`

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

50 users create posts, some linked to their own observation. They also react, comment, ask questions, edit their own posts, delete their own comments, and delete their own posts.

Requests:

- `POST /api/community/posts`
- `POST /api/community/posts/:id/comments`
- `DELETE /api/community/posts/:postId/comments/:commentId`
- `POST /api/community/posts/:id/reactions`
- `POST /api/community/posts/:id/questions`
- `PATCH /api/community/posts/:id`
- `DELETE /api/community/posts/:id`

Bad-Origin comment delete must return 403.

### Scenario F: Model Static Downloads

50 visitors download static model resources:

- `/assets/osea/bird_model.onnx`
- `/assets/vendor/ort-wasm-simd-threaded.wasm`
- `/assets/osea/bird_info.json`

This is not a 50-browser inference test. Real browser inference should be tested later at 1, 5, and 10 concurrency.

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
