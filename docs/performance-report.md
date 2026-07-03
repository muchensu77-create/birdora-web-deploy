# Birdora Performance Report

- Test time: 2026-07-03T13:32:33.893Z - 2026-07-03T13:32:41.187Z
- runId: `loadtest-d-1783085553893`
- status: `passed`
- API_BASE_URL: `http://127.0.0.1:53430`
- WEB_BASE_URL: `http://127.0.0.1:53431`
- TEST_ORIGIN: `http://127.0.0.1:53431`
- DATABASE_FILE isolated: `true` (C:\Users\Administrator\AppData\Local\Temp\birdora-load-test-v160-verify-1783085537114\birdora-load-test-verify.sqlite)
- COMMUNITY_UPLOAD_DIR isolated: `true` (C:\Users\Administrator\AppData\Local\Temp\birdora-load-test-v160-verify-1783085537114\load-test-community-uploads)
- OBSERVATION_UPLOAD_DIR isolated: `true` (C:\Users\Administrator\AppData\Local\Temp\birdora-load-test-v160-verify-1783085537114\load-test-observation-uploads)
- SQLite WAL: `wal`
- SQLite busy_timeout: `5000ms`

## Overall Metrics

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 1514 | 1514 | 0 | 0 | 0 | 0 | 205ms | 49ms | 822ms | 1106ms | 2268ms | 2755ms |

## Scenario Results

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A static resources | 300 | 300 | 0 | 0 | 0 | 0 | 57ms | 50ms | 106ms | 132ms | 146ms | 219ms |
| B community readonly | 200 | 200 | 0 | 0 | 0 | 0 | 39ms | 32ms | 95ms | 122ms | 141ms | 145ms |
| C auth session | 250 | 250 | 0 | 0 | 0 | 0 | 277ms | 2ms | 905ms | 914ms | 931ms | 933ms |
| D observation save | 202 | 202 | 0 | 0 | 0 | 0 | 47ms | 40ms | 90ms | 98ms | 105ms | 109ms |
| E community write | 251 | 251 | 0 | 0 | 0 | 0 | 75ms | 77ms | 121ms | 127ms | 135ms | 135ms |
| E community write deletes | 101 | 101 | 0 | 0 | 0 | 0 | 25ms | 24ms | 46ms | 52ms | 55ms | 56ms |
| F model static downloads | 200 | 200 | 0 | 0 | 0 | 0 | 925ms | 765ms | 2150ms | 2376ms | 2570ms | 2755ms |
| G image boundaries | 10 | 10 | 0 | 0 | 0 | 0 | 4ms | 2ms | 8ms | 11ms | 11ms | 11ms |

## Endpoint Results

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A static resources GET GET / | 50 | 50 | 0 | 0 | 0 | 0 | 46ms | 46ms | 56ms | 59ms | 60ms | 60ms |
| A static resources GET GET /assets/hero-birdora.png | 50 | 50 | 0 | 0 | 0 | 0 | 112ms | 121ms | 141ms | 164ms | 219ms | 219ms |
| A static resources GET GET /community-api.js | 50 | 50 | 0 | 0 | 0 | 0 | 46ms | 39ms | 95ms | 97ms | 99ms | 99ms |
| A static resources GET GET /observation-api.js | 50 | 50 | 0 | 0 | 0 | 0 | 50ms | 58ms | 68ms | 69ms | 69ms | 69ms |
| A static resources GET GET /script.js | 50 | 50 | 0 | 0 | 0 | 0 | 42ms | 42ms | 58ms | 58ms | 60ms | 60ms |
| A static resources GET GET /styles.css | 50 | 50 | 0 | 0 | 0 | 0 | 46ms | 49ms | 51ms | 51ms | 54ms | 54ms |
| B community readonly GET GET /api/community/posts | 50 | 50 | 0 | 0 | 0 | 0 | 78ms | 72ms | 133ms | 141ms | 145ms | 145ms |
| B community readonly GET GET /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 26ms | 25ms | 45ms | 48ms | 50ms | 50ms |
| B community readonly GET GET /api/community/posts/:id/comments | 50 | 50 | 0 | 0 | 0 | 0 | 41ms | 41ms | 48ms | 49ms | 67ms | 67ms |
| B community readonly GET GET /api/community/posts/:id/image | 50 | 50 | 0 | 0 | 0 | 0 | 13ms | 14ms | 15ms | 15ms | 15ms | 15ms |
| C auth session GET GET /api/auth/me | 50 | 50 | 0 | 0 | 0 | 0 | 1ms | 1ms | 2ms | 3ms | 6ms | 6ms |
| C auth session GET GET /api/auth/status | 50 | 50 | 0 | 0 | 0 | 0 | 2ms | 1ms | 2ms | 3ms | 6ms | 6ms |
| C auth session POST POST /api/auth/login | 50 | 50 | 0 | 0 | 0 | 0 | 877ms | 855ms | 921ms | 926ms | 933ms | 933ms |
| C auth session POST POST /api/auth/logout | 50 | 50 | 0 | 0 | 0 | 0 | 2ms | 2ms | 3ms | 3ms | 7ms | 7ms |
| C auth session POST POST /api/auth/register | 50 | 50 | 0 | 0 | 0 | 0 | 501ms | 516ms | 860ms | 872ms | 931ms | 931ms |
| D observation save GET GET /api/observations/:id | 50 | 50 | 0 | 0 | 0 | 0 | 25ms | 25ms | 26ms | 26ms | 27ms | 27ms |
| D observation save GET GET /api/observations/:id/image | 50 | 50 | 0 | 0 | 0 | 0 | 40ms | 41ms | 48ms | 49ms | 50ms | 50ms |
| D observation save GET GET /api/observations/:id/image cross user | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| D observation save GET GET /api/observations/me | 50 | 50 | 0 | 0 | 0 | 0 | 67ms | 66ms | 97ms | 102ms | 105ms | 105ms |
| D observation save POST POST /api/observations | 50 | 50 | 0 | 0 | 0 | 0 | 58ms | 57ms | 98ms | 104ms | 109ms | 109ms |
| D observation save POST POST /api/observations bad Origin | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| E community write deletes DELETE DELETE /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 29ms | 29ms | 52ms | 54ms | 56ms | 56ms |
| E community write deletes DELETE DELETE /api/community/posts/:postId/comments/:commentId | 50 | 50 | 0 | 0 | 0 | 0 | 21ms | 21ms | 37ms | 39ms | 42ms | 42ms |
| E community write deletes DELETE DELETE /api/community/posts/:postId/comments/:commentId bad Origin | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| E community write GET GET /api/community/posts/:id/comments map ids | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| E community write PATCH PATCH /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 47ms | 45ms | 78ms | 82ms | 86ms | 86ms |
| E community write POST POST /api/community/posts | 50 | 50 | 0 | 0 | 0 | 0 | 47ms | 47ms | 77ms | 81ms | 84ms | 84ms |
| E community write POST POST /api/community/posts/:id/comments | 50 | 50 | 0 | 0 | 0 | 0 | 107ms | 108ms | 112ms | 113ms | 114ms | 114ms |
| E community write POST POST /api/community/posts/:id/questions | 50 | 50 | 0 | 0 | 0 | 0 | 122ms | 121ms | 134ms | 135ms | 135ms | 135ms |
| E community write POST POST /api/community/posts/:id/reactions | 50 | 50 | 0 | 0 | 0 | 0 | 54ms | 52ms | 92ms | 98ms | 102ms | 102ms |
| F model static downloads GET GET /assets/osea/bird_info.json | 50 | 50 | 0 | 0 | 0 | 0 | 154ms | 84ms | 234ms | 255ms | 790ms | 790ms |
| F model static downloads GET GET /assets/osea/bird_model.onnx | 50 | 50 | 0 | 0 | 0 | 0 | 1917ms | 2061ms | 2496ms | 2570ms | 2755ms | 2755ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.mjs | 50 | 50 | 0 | 0 | 0 | 0 | 371ms | 371ms | 540ms | 669ms | 845ms | 845ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.wasm | 50 | 50 | 0 | 0 | 0 | 0 | 1260ms | 1189ms | 1897ms | 2001ms | 2148ms | 2148ms |
| G image boundaries GET GET /api/community/posts/:id/image legal | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| G image boundaries GET GET /api/observations/:id/image legal | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/community/posts bad data URL | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/community/posts invalid MIME | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/community/posts legal image | 1 | 1 | 0 | 0 | 0 | 0 | 5ms | 5ms | 5ms | 5ms | 5ms | 5ms |
| G image boundaries POST POST /api/community/posts oversized image | 1 | 1 | 0 | 0 | 0 | 0 | 11ms | 11ms | 11ms | 11ms | 11ms | 11ms |
| G image boundaries POST POST /api/observations bad data URL | 1 | 1 | 0 | 0 | 0 | 0 | 3ms | 3ms | 3ms | 3ms | 3ms | 3ms |
| G image boundaries POST POST /api/observations invalid MIME | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/observations legal image | 1 | 1 | 0 | 0 | 0 | 0 | 3ms | 3ms | 3ms | 3ms | 3ms | 3ms |
| G image boundaries POST POST /api/observations oversized image | 1 | 1 | 0 | 0 | 0 | 0 | 8ms | 8ms | 8ms | 8ms | 8ms | 8ms |

## Validation

| Check | Result | Detail |
| --- | --- | --- |
| Write target safety check | PASS |  |
| Scenario A 5xx = 0 | PASS |  |
| Scenario A p95 < 1000ms | PASS | p95=68ms |
| Scenario A image p95 < 1500ms | PASS | p95=164ms |
| Scenario A: static resources completed | PASS | 300 requests in 497ms |
| Scenario C active test sessions are available | PASS |  |
| Scenario C: login and session completed | PASS | 250 requests in 1858ms |
| Scenario D illegal Origin returns 403 | PASS |  |
| Scenario D cross-user observation image is forbidden | PASS |  |
| Scenario D created one observation per user | PASS | 50/50 |
| Scenario D: observation save loop completed | PASS | 202 requests in 200ms |
| Scenario E created one post per user | PASS | 50/50 |
| Scenario E mapped comments for deletion | PASS |  |
| Scenario E: community write loop completed | PASS | 251 requests in 532ms |
| Scenario B 5xx = 0 | PASS |  |
| Scenario B image p95 < 1500ms | PASS |  |
| Scenario B: community readonly completed | PASS | 200 requests in 254ms |
| Scenario E illegal Origin comment delete returns 403 | PASS |  |
| Scenario E: community delete loop completed | PASS | 101 requests in 105ms |
| Scenario F 5xx = 0 | PASS |  |
| Scenario F: model static downloads completed | PASS | 200 requests in 3804ms |
| Scenario G image read p95 < 1500ms | PASS |  |
| Scenario G: image boundary checks completed | PASS | 10 requests in 37ms |
| Overall 5xx = 0 | PASS | 5xx=0 |
| Overall timeout = 0 | PASS | timeouts=0 |
| Write business success rate >= 99% | PASS | 100% |
| API p95 < 1000ms | PASS | p95=832ms |

## 4xx Classification

```
{
  "400": 6,
  "403": 3
}
```

## 5xx Details

No 5xx responses observed.

## Request Id Samples

```
[
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "3bfa2106-2043-4fba-8aa7-a351d2950fac"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "6e7c5ecf-bd7f-4031-a199-7c64c6bcd296"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "a4cd5896-f6e8-455b-b4a0-d5e852253428"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "6ab92774-5568-4478-b70e-e0224d6539ea"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "23be4d3b-a9a6-4cda-bb2a-a25b3d6003ef"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "9bac2d09-4764-46a2-9384-c496e0c7c222"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "027d606d-02dc-4ee0-975e-f3e223cc84ac"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "006bde2e-b130-41cf-8672-ff0e4ddc1de8"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "d1b3b430-160a-4b5f-af4c-a7c1ad59a82b"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "c6dc4617-f4c9-4cb9-91a6-11de1b34b69e"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "4cb5a989-47cc-4632-b483-3c377ebfa3bd"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "9859c7b6-59ee-4b71-860d-7f7481223066"
  }
]
```

## Error Samples

No unexpected errors captured.

## Bottleneck Judgment

- SQLite WAL enabled: true
- SQLite busy_timeout configured: true
- SQLite lock wait judgment: No explicit SQLITE_BUSY/database locked errors were observed.
- Auth password KDF judgment: Auth password timing headers were not captured; enable AUTH_TIMING_HEADERS=1 for phase breakdown.
- Auth rate-limit judgment: Auth rate limiting did not affect this run.
- Image tail latency: Image-related writes did not show a clear tail-latency spike in this run.
- Static/model bandwidth: Model static downloads did not dominate the run by p95 threshold.

Slowest endpoints by p95:

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| F model static downloads GET GET /assets/osea/bird_model.onnx | 50 | 50 | 0 | 0 | 0 | 0 | 1917ms | 2061ms | 2496ms | 2570ms | 2755ms | 2755ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.wasm | 50 | 50 | 0 | 0 | 0 | 0 | 1260ms | 1189ms | 1897ms | 2001ms | 2148ms | 2148ms |
| C auth session POST POST /api/auth/login | 50 | 50 | 0 | 0 | 0 | 0 | 877ms | 855ms | 921ms | 926ms | 933ms | 933ms |
| C auth session POST POST /api/auth/register | 50 | 50 | 0 | 0 | 0 | 0 | 501ms | 516ms | 860ms | 872ms | 931ms | 931ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.mjs | 50 | 50 | 0 | 0 | 0 | 0 | 371ms | 371ms | 540ms | 669ms | 845ms | 845ms |

## Auth Timing Breakdown

No auth timing headers captured.

## Next Steps

- Keep image write instrumentation; async image persistence is not urgent from this run alone.
- Proceed to 1/5/10 real-browser model ramp after this script is stable.
- If 50-concurrency writes pass repeatedly but p95 grows at 100 users, evaluate PostgreSQL or a queue-backed write path.

## Cleanup

Dry run:

```
node scripts/cleanup-load-test-data.js --runId loadtest-d-1783085553893
```

Apply cleanup:

```
node scripts/cleanup-load-test-data.js --runId loadtest-d-1783085553893 --yes
```
