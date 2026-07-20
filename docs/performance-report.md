# Birdora Performance Report

- Test time: 2026-07-20T03:13:04.633Z - 2026-07-20T03:13:13.286Z
- runId: `loadtest-d-v172-final-20260720`
- status: `passed`
- API_BASE_URL: `http://127.0.0.1:62326`
- WEB_BASE_URL: `http://127.0.0.1:62325`
- TEST_ORIGIN: `http://127.0.0.1:62325`
- DATABASE_FILE isolated: `true` (D:\birdora-load-test-v172\browser50-load-test-v172-final-20260720\browser50.sqlite)
- COMMUNITY_UPLOAD_DIR isolated: `true` (D:\birdora-load-test-v172\browser50-load-test-v172-final-20260720\community)
- OBSERVATION_UPLOAD_DIR isolated: `true` (D:\birdora-load-test-v172\browser50-load-test-v172-final-20260720\observations)
- SQLite WAL: `wal`
- SQLite busy_timeout: `5000ms`

## Overall Metrics

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 1518 | 1518 | 0 | 0 | 0 | 0 | 248ms | 66ms | 823ms | 1520ms | 2780ms | 3558ms |

## Scenario Results

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A static resources | 300 | 300 | 0 | 0 | 0 | 0 | 72ms | 64ms | 119ms | 180ms | 215ms | 222ms |
| B community readonly | 200 | 200 | 0 | 0 | 0 | 0 | 66ms | 52ms | 140ms | 174ms | 201ms | 208ms |
| C auth session | 250 | 250 | 0 | 0 | 0 | 0 | 284ms | 2ms | 897ms | 909ms | 924ms | 985ms |
| D observation save | 202 | 202 | 0 | 0 | 0 | 0 | 64ms | 54ms | 120ms | 131ms | 138ms | 142ms |
| E community write | 251 | 251 | 0 | 0 | 0 | 0 | 114ms | 122ms | 182ms | 184ms | 186ms | 186ms |
| E community write deletes | 101 | 101 | 0 | 0 | 0 | 0 | 40ms | 40ms | 66ms | 76ms | 84ms | 84ms |
| F model static downloads | 200 | 200 | 0 | 0 | 0 | 0 | 1122ms | 471ms | 2560ms | 3024ms | 3483ms | 3558ms |
| G image boundaries | 14 | 14 | 0 | 0 | 0 | 0 | 4ms | 2ms | 14ms | 14ms | 14ms | 14ms |

## Endpoint Results

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A static resources GET GET / | 50 | 50 | 0 | 0 | 0 | 0 | 57ms | 56ms | 72ms | 73ms | 77ms | 77ms |
| A static resources GET GET /assets/hero-birdora.png | 50 | 50 | 0 | 0 | 0 | 0 | 144ms | 148ms | 215ms | 217ms | 222ms | 222ms |
| A static resources GET GET /community-api.js | 50 | 50 | 0 | 0 | 0 | 0 | 49ms | 46ms | 73ms | 99ms | 103ms | 103ms |
| A static resources GET GET /observation-api.js | 50 | 50 | 0 | 0 | 0 | 0 | 47ms | 52ms | 76ms | 99ms | 100ms | 100ms |
| A static resources GET GET /script.js | 50 | 50 | 0 | 0 | 0 | 0 | 63ms | 68ms | 76ms | 77ms | 77ms | 77ms |
| A static resources GET GET /styles.css | 50 | 50 | 0 | 0 | 0 | 0 | 70ms | 71ms | 77ms | 78ms | 79ms | 79ms |
| B community readonly GET GET /api/community/posts | 50 | 50 | 0 | 0 | 0 | 0 | 112ms | 113ms | 191ms | 201ms | 208ms | 208ms |
| B community readonly GET GET /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 37ms | 35ms | 67ms | 72ms | 74ms | 74ms |
| B community readonly GET GET /api/community/posts/:id/comments | 50 | 50 | 0 | 0 | 0 | 0 | 63ms | 64ms | 74ms | 75ms | 75ms | 75ms |
| B community readonly GET GET /api/community/posts/:id/image | 50 | 50 | 0 | 0 | 0 | 0 | 51ms | 51ms | 52ms | 52ms | 53ms | 53ms |
| C auth session GET GET /api/auth/me | 50 | 50 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 2ms | 2ms | 2ms |
| C auth session GET GET /api/auth/status | 50 | 50 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 2ms | 3ms | 3ms |
| C auth session POST POST /api/auth/login | 50 | 50 | 0 | 0 | 0 | 0 | 866ms | 846ms | 910ms | 913ms | 916ms | 916ms |
| C auth session POST POST /api/auth/logout | 50 | 50 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 3ms | 3ms | 3ms |
| C auth session POST POST /api/auth/register | 50 | 50 | 0 | 0 | 0 | 0 | 552ms | 561ms | 913ms | 924ms | 985ms | 985ms |
| D observation save GET GET /api/observations/:id | 50 | 50 | 0 | 0 | 0 | 0 | 35ms | 35ms | 36ms | 37ms | 37ms | 37ms |
| D observation save GET GET /api/observations/:id/image | 50 | 50 | 0 | 0 | 0 | 0 | 56ms | 56ms | 66ms | 69ms | 70ms | 70ms |
| D observation save GET GET /api/observations/:id/image cross user | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| D observation save GET GET /api/observations/me | 50 | 50 | 0 | 0 | 0 | 0 | 88ms | 91ms | 129ms | 133ms | 136ms | 136ms |
| D observation save POST POST /api/observations | 50 | 50 | 0 | 0 | 0 | 0 | 77ms | 73ms | 132ms | 138ms | 142ms | 142ms |
| D observation save POST POST /api/observations bad Origin | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| E community write deletes DELETE DELETE /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 43ms | 40ms | 76ms | 82ms | 84ms | 84ms |
| E community write deletes DELETE DELETE /api/community/posts/:postId/comments/:commentId | 50 | 50 | 0 | 0 | 0 | 0 | 39ms | 40ms | 59ms | 61ms | 63ms | 63ms |
| E community write deletes DELETE DELETE /api/community/posts/:postId/comments/:commentId bad Origin | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| E community write GET GET /api/community/posts/:id/comments map ids | 1 | 1 | 0 | 0 | 0 | 0 | 3ms | 3ms | 3ms | 3ms | 3ms | 3ms |
| E community write POST POST /api/community/posts/:id/comments | 50 | 50 | 0 | 0 | 0 | 0 | 155ms | 154ms | 157ms | 157ms | 158ms | 158ms |
| E community write POST POST /api/community/posts/:id/questions | 50 | 50 | 0 | 0 | 0 | 0 | 179ms | 182ms | 185ms | 186ms | 186ms | 186ms |
| E community write POST POST /api/v1/drafts | 50 | 50 | 0 | 0 | 0 | 0 | 49ms | 48ms | 78ms | 83ms | 86ms | 86ms |
| E community write POST POST /api/v1/drafts/:id/publish | 50 | 50 | 0 | 0 | 0 | 0 | 111ms | 112ms | 131ms | 138ms | 141ms | 141ms |
| E community write PUT PUT /api/v1/posts/:id/like | 50 | 50 | 0 | 0 | 0 | 0 | 80ms | 77ms | 142ms | 149ms | 154ms | 154ms |
| F model static downloads GET GET /assets/osea/bird_info.json | 50 | 50 | 0 | 0 | 0 | 0 | 201ms | 86ms | 450ms | 468ms | 471ms | 471ms |
| F model static downloads GET GET /assets/osea/bird_model.onnx | 50 | 50 | 0 | 0 | 0 | 0 | 2462ms | 2370ms | 3184ms | 3483ms | 3558ms | 3558ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.mjs | 50 | 50 | 0 | 0 | 0 | 0 | 310ms | 289ms | 442ms | 456ms | 875ms | 875ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.wasm | 50 | 50 | 0 | 0 | 0 | 0 | 1517ms | 1520ms | 2145ms | 2249ms | 2450ms | 2450ms |
| G image boundaries GET GET /api/community/posts/:id/image legal | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| G image boundaries GET GET /api/observations/:id/image legal | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/observations bad data URL | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/observations invalid MIME | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/observations legal image | 1 | 1 | 0 | 0 | 0 | 0 | 3ms | 3ms | 3ms | 3ms | 3ms | 3ms |
| G image boundaries POST POST /api/observations oversized image | 1 | 1 | 0 | 0 | 0 | 0 | 14ms | 14ms | 14ms | 14ms | 14ms | 14ms |
| G image boundaries POST POST /api/v1/drafts | 4 | 4 | 0 | 0 | 0 | 0 | 5ms | 2ms | 14ms | 14ms | 14ms | 14ms |
| G image boundaries POST POST /api/v1/drafts/:id/publish | 4 | 4 | 0 | 0 | 0 | 0 | 5ms | 2ms | 13ms | 13ms | 13ms | 13ms |

## Validation

| Check | Result | Detail |
| --- | --- | --- |
| Write target safety check | PASS |  |
| Scenario A 5xx = 0 | PASS |  |
| Scenario A p95 < 1000ms | PASS | p95=77ms |
| Scenario A image p95 < 1500ms | PASS | p95=217ms |
| Scenario A: static resources completed | PASS | 300 requests in 574ms |
| Scenario C active test sessions are available | PASS |  |
| Scenario C: login and session completed | PASS | 250 requests in 1869ms |
| Scenario D illegal Origin returns 403 | PASS |  |
| Scenario D cross-user observation image is forbidden | PASS |  |
| Scenario D created one observation per user | PASS | 50/50 |
| Scenario D: observation save loop completed | PASS | 202 requests in 271ms |
| Scenario E canonically published one post per user | PASS | 50/50 |
| Scenario E mapped comments for deletion | PASS |  |
| Scenario E: community write loop completed | PASS | 251 requests in 736ms |
| Scenario B 5xx = 0 | PASS |  |
| Scenario B image p95 < 1500ms | PASS |  |
| Scenario B: community readonly completed | PASS | 200 requests in 395ms |
| Scenario E illegal Origin comment delete returns 403 | PASS |  |
| Scenario E: community delete loop completed | PASS | 101 requests in 156ms |
| Scenario F 5xx = 0 | PASS |  |
| Scenario F: model static downloads completed | PASS | 200 requests in 4579ms |
| Scenario G image read p95 < 1500ms | PASS |  |
| Scenario G: image boundary checks completed | PASS | 14 requests in 65ms |
| Overall 5xx = 0 | PASS | 5xx=0 |
| Overall timeout = 0 | PASS | timeouts=0 |
| Write business success rate >= 99% | PASS | 100% |
| API p95 < 1000ms | PASS | p95=827ms |

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
    "requestId": "66ea9e55-98f7-495e-9fd7-763fcd699c0d"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "5f3b2c80-4eda-4a7d-8cae-cbff2346f483"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "0d07f3ec-3728-419d-978a-083f98ce76ca"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "16814ed3-79d6-4607-9c5b-fef8401a96fc"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "a8258f33-35d2-4eb3-9173-8ab9a4018a68"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "179a355d-3e95-4d81-a8cf-6dbd6600ec68"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "0fcc82f9-adcd-4d94-ae30-c3bc6b798bb3"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "a6d9b5d5-b958-4b69-897a-7f5a11556343"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "a731ff66-6389-4331-8f25-99ff1939ac58"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "d2f01079-6708-4288-92b6-e7c05d4509ef"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "0942519a-0b4f-4dfc-9625-9ca8c81be1f9"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "25abd95e-f82e-45da-bcd3-1de287c00ce3"
  }
]
```

## Error Samples

No unexpected errors captured.

## Bottleneck Judgment

- SQLite WAL enabled: true
- SQLite busy_timeout configured: true
- SQLite lock wait judgment: No explicit SQLITE_BUSY/database locked errors were observed.
- Auth password KDF judgment: Password KDF timing is visible in auth headers; slowest password timing p95=911.1ms.
- Auth rate-limit judgment: Auth rate limiting did not affect this run.
- Image tail latency: Image-related writes did not show a clear tail-latency spike in this run.
- Static/model bandwidth: Model file download p95 is high; static bandwidth/cache behavior should be reviewed.

Slowest endpoints by p95:

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| F model static downloads GET GET /assets/osea/bird_model.onnx | 50 | 50 | 0 | 0 | 0 | 0 | 2462ms | 2370ms | 3184ms | 3483ms | 3558ms | 3558ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.wasm | 50 | 50 | 0 | 0 | 0 | 0 | 1517ms | 1520ms | 2145ms | 2249ms | 2450ms | 2450ms |
| C auth session POST POST /api/auth/register | 50 | 50 | 0 | 0 | 0 | 0 | 552ms | 561ms | 913ms | 924ms | 985ms | 985ms |
| C auth session POST POST /api/auth/login | 50 | 50 | 0 | 0 | 0 | 0 | 866ms | 846ms | 910ms | 913ms | 916ms | 916ms |
| F model static downloads GET GET /assets/osea/bird_info.json | 50 | 50 | 0 | 0 | 0 | 0 | 201ms | 86ms | 450ms | 468ms | 471ms | 471ms |

## Auth Timing Breakdown

| Name | Count | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| POST /api/auth/login auth_total | 50 | 864ms | 840.8ms | 909.4ms | 911.4ms | 914ms | 914ms |
| POST /api/auth/login password_compare | 50 | 864ms | 840.4ms | 909.1ms | 911.1ms | 913.5ms | 913.5ms |
| POST /api/auth/register auth_total | 50 | 512ms | 520.2ms | 864.3ms | 874.6ms | 934.8ms | 934.8ms |
| POST /api/auth/register password_hash | 50 | 510ms | 519ms | 862.9ms | 873.6ms | 933.8ms | 933.8ms |
| POST /api/auth/register auth_db_insert | 50 | 1ms | 0.8ms | 1ms | 1.2ms | 5.7ms | 5.7ms |
| POST /api/auth/register auth_jwt | 50 | 0ms | 0.3ms | 0.4ms | 0.5ms | 2.4ms | 2.4ms |
| POST /api/auth/login auth_jwt | 50 | 0ms | 0.2ms | 0.3ms | 0.4ms | 0.6ms | 0.6ms |
| POST /api/auth/login auth_db_lookup | 50 | 0ms | 0.1ms | 0.2ms | 0.2ms | 0.3ms | 0.3ms |
| POST /api/auth/register auth_db_lookup | 50 | 0ms | 0.1ms | 0.1ms | 0.2ms | 0.8ms | 0.8ms |

## Next Steps

- Keep image write instrumentation; async image persistence is not urgent from this run alone.
- Review static asset caching and bandwidth before browser model ramp tests.
- If 50-concurrency writes pass repeatedly but p95 grows at 100 users, evaluate PostgreSQL or a queue-backed write path.

## Cleanup

Dry run:

```
node scripts/cleanup-load-test-data.js --runId loadtest-d-v172-final-20260720
```

Apply cleanup:

```
node scripts/cleanup-load-test-data.js --runId loadtest-d-v172-final-20260720 --yes
```
