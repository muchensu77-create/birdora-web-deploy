# Birdora Performance Report

- Test time: 2026-07-02T12:34:27.461Z - 2026-07-02T12:34:40.432Z
- runId: `loadtest-d-1782995667461`
- status: `completed_with_findings`
- API_BASE_URL: `http://127.0.0.1:4520`
- WEB_BASE_URL: `http://127.0.0.1:4521`
- TEST_ORIGIN: `http://127.0.0.1:4521`
- DATABASE_FILE isolated: `true` (C:\Users\ADMINI~1\AppData\Local\Temp\birdora-load-test-release-1782995644135\load-test.sqlite)
- COMMUNITY_UPLOAD_DIR isolated: `true` (C:\Users\ADMINI~1\AppData\Local\Temp\birdora-load-test-release-1782995644135\load-test-uploads-community)
- OBSERVATION_UPLOAD_DIR isolated: `true` (C:\Users\ADMINI~1\AppData\Local\Temp\birdora-load-test-release-1782995644135\load-test-uploads-observations)
- SQLite WAL: `wal`
- SQLite busy_timeout: `5000ms`

## Overall Metrics

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 1464 | 1464 | 0 | 0 | 0 | 0 | 415ms | 58ms | 1926ms | 3169ms | 3471ms | 3482ms |

## Scenario Results

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A static resources | 300 | 300 | 0 | 0 | 0 | 0 | 65ms | 52ms | 149ms | 158ms | 186ms | 250ms |
| B community readonly | 200 | 200 | 0 | 0 | 0 | 0 | 42ms | 37ms | 89ms | 119ms | 143ms | 149ms |
| C auth session | 250 | 250 | 0 | 0 | 0 | 0 | 1356ms | 83ms | 3461ms | 3472ms | 3481ms | 3482ms |
| D observation save | 202 | 202 | 0 | 0 | 0 | 0 | 61ms | 54ms | 112ms | 123ms | 132ms | 136ms |
| E community write | 251 | 251 | 0 | 0 | 0 | 0 | 81ms | 87ms | 126ms | 129ms | 135ms | 136ms |
| E community write deletes | 101 | 101 | 0 | 0 | 0 | 0 | 28ms | 25ms | 53ms | 59ms | 64ms | 65ms |
| F model static downloads | 150 | 150 | 0 | 0 | 0 | 0 | 1373ms | 1485ms | 2753ms | 2892ms | 3067ms | 3088ms |
| G image boundaries | 10 | 10 | 0 | 0 | 0 | 0 | 4ms | 2ms | 11ms | 12ms | 12ms | 12ms |

## Endpoint Results

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A static resources GET GET / | 50 | 50 | 0 | 0 | 0 | 0 | 50ms | 51ms | 63ms | 67ms | 70ms | 70ms |
| A static resources GET GET /assets/hero-birdora.png | 50 | 50 | 0 | 0 | 0 | 0 | 136ms | 152ms | 182ms | 195ms | 250ms | 250ms |
| A static resources GET GET /community-api.js | 50 | 50 | 0 | 0 | 0 | 0 | 41ms | 36ms | 52ms | 96ms | 97ms | 97ms |
| A static resources GET GET /observation-api.js | 50 | 50 | 0 | 0 | 0 | 0 | 57ms | 64ms | 75ms | 76ms | 78ms | 78ms |
| A static resources GET GET /script.js | 50 | 50 | 0 | 0 | 0 | 0 | 41ms | 46ms | 48ms | 50ms | 52ms | 52ms |
| A static resources GET GET /styles.css | 50 | 50 | 0 | 0 | 0 | 0 | 64ms | 65ms | 69ms | 72ms | 73ms | 73ms |
| B community readonly GET GET /api/community/posts | 50 | 50 | 0 | 0 | 0 | 0 | 75ms | 74ms | 133ms | 143ms | 149ms | 149ms |
| B community readonly GET GET /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 31ms | 29ms | 57ms | 59ms | 60ms | 60ms |
| B community readonly GET GET /api/community/posts/:id/comments | 50 | 50 | 0 | 0 | 0 | 0 | 47ms | 48ms | 57ms | 58ms | 60ms | 60ms |
| B community readonly GET GET /api/community/posts/:id/image | 50 | 50 | 0 | 0 | 0 | 0 | 16ms | 16ms | 18ms | 18ms | 19ms | 19ms |
| C auth session GET GET /api/auth/me | 50 | 50 | 0 | 0 | 0 | 0 | 26ms | 24ms | 44ms | 44ms | 45ms | 45ms |
| C auth session GET GET /api/auth/status | 50 | 50 | 0 | 0 | 0 | 0 | 148ms | 83ms | 106ms | 107ms | 3216ms | 3216ms |
| C auth session POST POST /api/auth/login | 50 | 50 | 0 | 0 | 0 | 0 | 3174ms | 3169ms | 3175ms | 3200ms | 3382ms | 3382ms |
| C auth session POST POST /api/auth/logout | 50 | 50 | 0 | 0 | 0 | 0 | 36ms | 37ms | 49ms | 52ms | 53ms | 53ms |
| C auth session POST POST /api/auth/register | 50 | 50 | 0 | 0 | 0 | 0 | 3396ms | 3461ms | 3479ms | 3481ms | 3482ms | 3482ms |
| D observation save GET GET /api/observations/:id | 50 | 50 | 0 | 0 | 0 | 0 | 34ms | 33ms | 36ms | 36ms | 37ms | 37ms |
| D observation save GET GET /api/observations/:id/image | 50 | 50 | 0 | 0 | 0 | 0 | 54ms | 54ms | 64ms | 66ms | 67ms | 67ms |
| D observation save GET GET /api/observations/:id/image cross user | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| D observation save GET GET /api/observations/me | 50 | 50 | 0 | 0 | 0 | 0 | 89ms | 91ms | 123ms | 128ms | 133ms | 133ms |
| D observation save POST POST /api/observations | 50 | 50 | 0 | 0 | 0 | 0 | 70ms | 67ms | 119ms | 129ms | 136ms | 136ms |
| D observation save POST POST /api/observations bad Origin | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| E community write deletes DELETE DELETE /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 33ms | 31ms | 59ms | 63ms | 65ms | 65ms |
| E community write deletes DELETE DELETE /api/community/posts/:postId/comments/:commentId | 50 | 50 | 0 | 0 | 0 | 0 | 23ms | 22ms | 40ms | 43ms | 44ms | 44ms |
| E community write deletes DELETE DELETE /api/community/posts/:postId/comments/:commentId bad Origin | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| E community write GET GET /api/community/posts/:id/comments map ids | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| E community write PATCH PATCH /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 46ms | 43ms | 81ms | 85ms | 89ms | 89ms |
| E community write POST POST /api/community/posts | 50 | 50 | 0 | 0 | 0 | 0 | 57ms | 58ms | 92ms | 97ms | 100ms | 100ms |
| E community write POST POST /api/community/posts/:id/comments | 50 | 50 | 0 | 0 | 0 | 0 | 115ms | 114ms | 119ms | 120ms | 120ms | 120ms |
| E community write POST POST /api/community/posts/:id/questions | 50 | 50 | 0 | 0 | 0 | 0 | 125ms | 126ms | 130ms | 135ms | 136ms | 136ms |
| E community write POST POST /api/community/posts/:id/reactions | 50 | 50 | 0 | 0 | 0 | 0 | 63ms | 62ms | 105ms | 110ms | 114ms | 114ms |
| F model static downloads GET GET /assets/osea/bird_info.json | 50 | 50 | 0 | 0 | 0 | 0 | 220ms | 219ms | 329ms | 349ms | 391ms | 391ms |
| F model static downloads GET GET /assets/osea/bird_model.onnx | 50 | 50 | 0 | 0 | 0 | 0 | 2236ms | 2187ms | 2951ms | 3025ms | 3088ms | 3088ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.wasm | 50 | 50 | 0 | 0 | 0 | 0 | 1663ms | 1739ms | 2350ms | 2745ms | 2763ms | 2763ms |
| G image boundaries GET GET /api/community/posts/:id/image legal | 1 | 1 | 0 | 0 | 0 | 0 | 3ms | 3ms | 3ms | 3ms | 3ms | 3ms |
| G image boundaries GET GET /api/observations/:id/image legal | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| G image boundaries POST POST /api/community/posts bad data URL | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/community/posts invalid MIME | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/community/posts legal image | 1 | 1 | 0 | 0 | 0 | 0 | 6ms | 6ms | 6ms | 6ms | 6ms | 6ms |
| G image boundaries POST POST /api/community/posts oversized image | 1 | 1 | 0 | 0 | 0 | 0 | 11ms | 11ms | 11ms | 11ms | 11ms | 11ms |
| G image boundaries POST POST /api/observations bad data URL | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/observations invalid MIME | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| G image boundaries POST POST /api/observations legal image | 1 | 1 | 0 | 0 | 0 | 0 | 4ms | 4ms | 4ms | 4ms | 4ms | 4ms |
| G image boundaries POST POST /api/observations oversized image | 1 | 1 | 0 | 0 | 0 | 0 | 12ms | 12ms | 12ms | 12ms | 12ms | 12ms |

## Validation

| Check | Result | Detail |
| --- | --- | --- |
| Write target safety check | PASS |  |
| Scenario A 5xx = 0 | PASS |  |
| Scenario A p95 < 1000ms | PASS | p95=74ms |
| Scenario A image p95 < 1500ms | PASS | p95=195ms |
| Scenario A: static resources completed | PASS | 300 requests in 523ms |
| Scenario C active test sessions are available | PASS |  |
| Scenario C: login and session completed | PASS | 250 requests in 6814ms |
| Scenario D illegal Origin returns 403 | PASS |  |
| Scenario D cross-user observation image is forbidden | PASS |  |
| Scenario D created one observation per user | PASS | 50/50 |
| Scenario D: observation save loop completed | PASS | 202 requests in 256ms |
| Scenario E created one post per user | PASS | 50/50 |
| Scenario E mapped comments for deletion | PASS |  |
| Scenario E: community write loop completed | PASS | 251 requests in 574ms |
| Scenario B 5xx = 0 | PASS |  |
| Scenario B image p95 < 1500ms | PASS |  |
| Scenario B: community readonly completed | PASS | 200 requests in 272ms |
| Scenario E illegal Origin comment delete returns 403 | PASS |  |
| Scenario E: community delete loop completed | PASS | 101 requests in 119ms |
| Scenario F 5xx = 0 | PASS |  |
| Scenario F: model static downloads completed | PASS | 150 requests in 4358ms |
| Scenario G image read p95 < 1500ms | PASS |  |
| Scenario G: image boundary checks completed | PASS | 10 requests in 47ms |
| Overall 5xx = 0 | PASS | 5xx=0 |
| Overall timeout = 0 | PASS | timeouts=0 |
| Write business success rate >= 99% | PASS | 100% |
| API p95 < 1000ms | FAIL | p95=3233ms |

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
    "requestId": "fe39f89e-fb16-4888-8958-9f4a288de6ef"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "9bcb6106-2403-4d05-9bc9-3e557e722655"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "30c49765-b19a-4e9d-b4ed-d87082d2ba45"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "3c1f23cf-7711-4653-a413-5ae6597f5dae"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "f7762ee4-fd3d-4eaa-870e-3b497cd07490"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "38f5f581-4dcf-436e-9aea-aed8399f3aaf"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "8e31186a-1a90-4071-9a8f-568c8de5d9d3"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "9af12c07-5eb3-4135-b25c-752edaffa068"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "f2c0fc39-0eee-4660-8c28-f66a1a5dc1ca"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "cbaf2782-4eeb-4bed-980c-2965f6147c1b"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "57ec5751-b8cf-4b03-8304-7fe15b85416b"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "cfd8678f-b2f0-4513-a5f2-985ea44b92e4"
  }
]
```

## Error Samples

No unexpected errors captured.

## Bottleneck Judgment

- SQLite WAL enabled: true
- SQLite busy_timeout configured: true
- SQLite lock wait judgment: No explicit SQLITE_BUSY/database locked errors were observed.
- Image tail latency: Image-related writes did not show a clear tail-latency spike in this run.
- Static/model bandwidth: Model file download p95 is high; static bandwidth/cache behavior should be reviewed.

Slowest endpoints by p95:

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| C auth session POST POST /api/auth/register | 50 | 50 | 0 | 0 | 0 | 0 | 3396ms | 3461ms | 3479ms | 3481ms | 3482ms | 3482ms |
| C auth session POST POST /api/auth/login | 50 | 50 | 0 | 0 | 0 | 0 | 3174ms | 3169ms | 3175ms | 3200ms | 3382ms | 3382ms |
| F model static downloads GET GET /assets/osea/bird_model.onnx | 50 | 50 | 0 | 0 | 0 | 0 | 2236ms | 2187ms | 2951ms | 3025ms | 3088ms | 3088ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.wasm | 50 | 50 | 0 | 0 | 0 | 0 | 1663ms | 1739ms | 2350ms | 2745ms | 2763ms | 2763ms |
| F model static downloads GET GET /assets/osea/bird_info.json | 50 | 50 | 0 | 0 | 0 | 0 | 220ms | 219ms | 329ms | 349ms | 391ms | 391ms |

## Next Steps

- Keep image write instrumentation; async image persistence is not urgent from this run alone.
- Review static asset caching and bandwidth before browser model ramp tests.
- If 50-concurrency writes pass repeatedly but p95 grows at 100 users, evaluate PostgreSQL or a queue-backed write path.

## Cleanup

Dry run:

```
node scripts/cleanup-load-test-data.js --runId loadtest-d-1782995667461
```

Apply cleanup:

```
node scripts/cleanup-load-test-data.js --runId loadtest-d-1782995667461 --yes
```
