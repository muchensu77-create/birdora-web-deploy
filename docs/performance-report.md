# Birdora Performance Report

- Test time: 2026-07-02T15:42:17.816Z - 2026-07-02T15:42:27.069Z
- runId: `loadtest-d-v1.5.1-release`
- status: `completed_with_findings`
- API_BASE_URL: `http://127.0.0.1:4620`
- WEB_BASE_URL: `http://127.0.0.1:4621`
- TEST_ORIGIN: `http://127.0.0.1:4621`
- DATABASE_FILE isolated: `true` (/tmp/birdora-v151-load-test-oVffqP/birdora-load-test.sqlite)
- COMMUNITY_UPLOAD_DIR isolated: `true` (/tmp/birdora-v151-load-test-oVffqP/load-test-community)
- OBSERVATION_UPLOAD_DIR isolated: `true` (/tmp/birdora-v151-load-test-oVffqP/load-test-observations)
- SQLite WAL: `wal`
- SQLite busy_timeout: `5000ms`

## Overall Metrics

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 1514 | 1514 | 0 | 0 | 0 | 0 | 293ms | 22ms | 595ms | 2945ms | 3519ms | 6383ms |

## Scenario Results

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A static resources | 300 | 300 | 0 | 0 | 0 | 0 | 27ms | 22ms | 65ms | 77ms | 93ms | 94ms |
| B community readonly | 200 | 200 | 0 | 0 | 0 | 0 | 19ms | 12ms | 48ms | 65ms | 77ms | 80ms |
| C auth session | 250 | 250 | 0 | 0 | 0 | 0 | 1400ms | 353ms | 3518ms | 3520ms | 3523ms | 6383ms |
| D observation save | 202 | 202 | 0 | 0 | 0 | 0 | 17ms | 17ms | 25ms | 26ms | 29ms | 37ms |
| E community write | 251 | 251 | 0 | 0 | 0 | 0 | 29ms | 27ms | 48ms | 52ms | 76ms | 97ms |
| E community write deletes | 101 | 101 | 0 | 0 | 0 | 0 | 8ms | 8ms | 13ms | 13ms | 15ms | 15ms |
| F model static downloads | 200 | 200 | 0 | 0 | 0 | 0 | 350ms | 109ms | 904ms | 962ms | 1208ms | 1271ms |
| G image boundaries | 10 | 10 | 0 | 0 | 0 | 0 | 2ms | 1ms | 5ms | 7ms | 7ms | 7ms |

## Endpoint Results

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A static resources GET GET / | 50 | 50 | 0 | 0 | 0 | 0 | 22ms | 22ms | 25ms | 26ms | 55ms | 55ms |
| A static resources GET GET /assets/hero-birdora.png | 50 | 50 | 0 | 0 | 0 | 0 | 70ms | 71ms | 80ms | 93ms | 94ms | 94ms |
| A static resources GET GET /community-api.js | 50 | 50 | 0 | 0 | 0 | 0 | 17ms | 16ms | 23ms | 35ms | 36ms | 36ms |
| A static resources GET GET /observation-api.js | 50 | 50 | 0 | 0 | 0 | 0 | 15ms | 14ms | 22ms | 22ms | 22ms | 22ms |
| A static resources GET GET /script.js | 50 | 50 | 0 | 0 | 0 | 0 | 19ms | 19ms | 24ms | 24ms | 24ms | 24ms |
| A static resources GET GET /styles.css | 50 | 50 | 0 | 0 | 0 | 0 | 21ms | 22ms | 24ms | 24ms | 25ms | 25ms |
| B community readonly GET GET /api/community/posts | 50 | 50 | 0 | 0 | 0 | 0 | 41ms | 40ms | 73ms | 77ms | 80ms | 80ms |
| B community readonly GET GET /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 17ms | 19ms | 28ms | 30ms | 30ms | 30ms |
| B community readonly GET GET /api/community/posts/:id/comments | 50 | 50 | 0 | 0 | 0 | 0 | 13ms | 12ms | 17ms | 30ms | 31ms | 31ms |
| B community readonly GET GET /api/community/posts/:id/image | 50 | 50 | 0 | 0 | 0 | 0 | 5ms | 5ms | 6ms | 6ms | 6ms | 6ms |
| C auth session GET GET /api/auth/me | 50 | 50 | 0 | 0 | 0 | 0 | 108ms | 74ms | 352ms | 353ms | 595ms | 595ms |
| C auth session GET GET /api/auth/status | 50 | 50 | 0 | 0 | 0 | 0 | 316ms | 353ms | 592ms | 593ms | 595ms | 595ms |
| C auth session POST POST /api/auth/login | 50 | 50 | 0 | 0 | 0 | 0 | 3079ms | 2945ms | 3293ms | 3454ms | 6383ms | 6383ms |
| C auth session POST POST /api/auth/logout | 50 | 50 | 0 | 0 | 0 | 0 | 45ms | 72ms | 81ms | 81ms | 81ms | 81ms |
| C auth session POST POST /api/auth/register | 50 | 50 | 0 | 0 | 0 | 0 | 3449ms | 3518ms | 3521ms | 3522ms | 3523ms | 3523ms |
| D observation save GET GET /api/observations/:id | 50 | 50 | 0 | 0 | 0 | 0 | 12ms | 12ms | 13ms | 14ms | 24ms | 24ms |
| D observation save GET GET /api/observations/:id/image | 50 | 50 | 0 | 0 | 0 | 0 | 20ms | 21ms | 25ms | 25ms | 29ms | 29ms |
| D observation save GET GET /api/observations/:id/image cross user | 1 | 1 | 0 | 0 | 0 | 0 | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |
| D observation save GET GET /api/observations/me | 50 | 50 | 0 | 0 | 0 | 0 | 19ms | 20ms | 25ms | 26ms | 37ms | 37ms |
| D observation save POST POST /api/observations | 50 | 50 | 0 | 0 | 0 | 0 | 16ms | 15ms | 26ms | 28ms | 29ms | 29ms |
| D observation save POST POST /api/observations bad Origin | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| E community write deletes DELETE DELETE /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 8ms | 8ms | 13ms | 14ms | 15ms | 15ms |
| E community write deletes DELETE DELETE /api/community/posts/:postId/comments/:commentId | 50 | 50 | 0 | 0 | 0 | 0 | 8ms | 7ms | 13ms | 13ms | 13ms | 13ms |
| E community write deletes DELETE DELETE /api/community/posts/:postId/comments/:commentId bad Origin | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| E community write GET GET /api/community/posts/:id/comments map ids | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| E community write PATCH PATCH /api/community/posts/:id | 50 | 50 | 0 | 0 | 0 | 0 | 17ms | 17ms | 25ms | 26ms | 27ms | 27ms |
| E community write POST POST /api/community/posts | 50 | 50 | 0 | 0 | 0 | 0 | 19ms | 19ms | 31ms | 33ms | 34ms | 34ms |
| E community write POST POST /api/community/posts/:id/comments | 50 | 50 | 0 | 0 | 0 | 0 | 41ms | 38ms | 40ms | 76ms | 97ms | 97ms |
| E community write POST POST /api/community/posts/:id/questions | 50 | 50 | 0 | 0 | 0 | 0 | 47ms | 48ms | 53ms | 54ms | 97ms | 97ms |
| E community write POST POST /api/community/posts/:id/reactions | 50 | 50 | 0 | 0 | 0 | 0 | 20ms | 20ms | 34ms | 36ms | 38ms | 38ms |
| F model static downloads GET GET /assets/osea/bird_info.json | 50 | 50 | 0 | 0 | 0 | 0 | 33ms | 35ms | 51ms | 54ms | 67ms | 67ms |
| F model static downloads GET GET /assets/osea/bird_model.onnx | 50 | 50 | 0 | 0 | 0 | 0 | 888ms | 878ms | 1037ms | 1208ms | 1271ms | 1271ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.mjs | 50 | 50 | 0 | 0 | 0 | 0 | 55ms | 47ms | 95ms | 105ms | 109ms | 109ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.wasm | 50 | 50 | 0 | 0 | 0 | 0 | 425ms | 441ms | 560ms | 571ms | 607ms | 607ms |
| G image boundaries GET GET /api/community/posts/:id/image legal | 1 | 1 | 0 | 0 | 0 | 0 | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |
| G image boundaries GET GET /api/observations/:id/image legal | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/community/posts bad data URL | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/community/posts invalid MIME | 1 | 1 | 0 | 0 | 0 | 0 | 1ms | 1ms | 1ms | 1ms | 1ms | 1ms |
| G image boundaries POST POST /api/community/posts legal image | 1 | 1 | 0 | 0 | 0 | 0 | 2ms | 2ms | 2ms | 2ms | 2ms | 2ms |
| G image boundaries POST POST /api/community/posts oversized image | 1 | 1 | 0 | 0 | 0 | 0 | 7ms | 7ms | 7ms | 7ms | 7ms | 7ms |
| G image boundaries POST POST /api/observations bad data URL | 1 | 1 | 0 | 0 | 0 | 0 | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |
| G image boundaries POST POST /api/observations invalid MIME | 1 | 1 | 0 | 0 | 0 | 0 | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |
| G image boundaries POST POST /api/observations legal image | 1 | 1 | 0 | 0 | 0 | 0 | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |
| G image boundaries POST POST /api/observations oversized image | 1 | 1 | 0 | 0 | 0 | 0 | 5ms | 5ms | 5ms | 5ms | 5ms | 5ms |

## Validation

| Check | Result | Detail |
| --- | --- | --- |
| Write target safety check | PASS |  |
| Scenario A 5xx = 0 | PASS |  |
| Scenario A p95 < 1000ms | PASS | p95=25ms |
| Scenario A image p95 < 1500ms | PASS | p95=93ms |
| Scenario A: static resources completed | PASS | 300 requests in 232ms |
| Scenario C active test sessions are available | PASS |  |
| Scenario C: login and session completed | PASS | 250 requests in 7065ms |
| Scenario D illegal Origin returns 403 | PASS |  |
| Scenario D cross-user observation image is forbidden | PASS |  |
| Scenario D created one observation per user | PASS | 50/50 |
| Scenario D: observation save loop completed | PASS | 202 requests in 73ms |
| Scenario E created one post per user | PASS | 50/50 |
| Scenario E mapped comments for deletion | PASS |  |
| Scenario E: community write loop completed | PASS | 251 requests in 205ms |
| Scenario B 5xx = 0 | PASS |  |
| Scenario B image p95 < 1500ms | PASS |  |
| Scenario B: community readonly completed | PASS | 200 requests in 132ms |
| Scenario E illegal Origin comment delete returns 403 | PASS |  |
| Scenario E: community delete loop completed | PASS | 101 requests in 33ms |
| Scenario F 5xx = 0 | PASS |  |
| Scenario F: model static downloads completed | PASS | 200 requests in 1483ms |
| Scenario G image read p95 < 1500ms | PASS |  |
| Scenario G: image boundary checks completed | PASS | 10 requests in 20ms |
| Overall 5xx = 0 | PASS | 5xx=0 |
| Overall timeout = 0 | PASS | timeouts=0 |
| Write business success rate >= 99% | PASS | 100% |
| API p95 < 1000ms | FAIL | p95=3513ms |

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
    "requestId": "65626756-f749-4e0e-abe8-53f677b39fa8"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "762ea897-b5e8-49b6-ab6d-1d2624b91123"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "c208bcc7-24b3-42b1-8fb8-6c3fdac397ba"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "e0905b9c-6557-4a95-904f-0f36873b75a0"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "0c1fbc12-c9a4-4f91-a09d-399b9ac39849"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "9cd61fb7-bba5-4153-a965-88d3e76aa85a"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "fef6000a-d864-4908-b4dc-7b561ec4cd5e"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "655d4c05-8b97-4ab8-a7c6-239f62323b8e"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "7ff9aabc-a2ea-4686-b408-a1f0e90bb513"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "8e5f1045-9529-45a4-af68-ca9843de3908"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "d39111bb-f428-4dff-bed8-d280ed0adeff"
  },
  {
    "scenario": "C auth session",
    "endpoint": "POST /api/auth/register",
    "status": 201,
    "requestId": "3a0e4338-fa81-4560-b0ff-50e069d00bb6"
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
- Static/model bandwidth: Model static downloads did not dominate the run by p95 threshold.

Slowest endpoints by p95:

| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| C auth session POST POST /api/auth/register | 50 | 50 | 0 | 0 | 0 | 0 | 3449ms | 3518ms | 3521ms | 3522ms | 3523ms | 3523ms |
| C auth session POST POST /api/auth/login | 50 | 50 | 0 | 0 | 0 | 0 | 3079ms | 2945ms | 3293ms | 3454ms | 6383ms | 6383ms |
| F model static downloads GET GET /assets/osea/bird_model.onnx | 50 | 50 | 0 | 0 | 0 | 0 | 888ms | 878ms | 1037ms | 1208ms | 1271ms | 1271ms |
| C auth session GET GET /api/auth/status | 50 | 50 | 0 | 0 | 0 | 0 | 316ms | 353ms | 592ms | 593ms | 595ms | 595ms |
| F model static downloads GET GET /assets/vendor/ort-wasm-simd-threaded.wasm | 50 | 50 | 0 | 0 | 0 | 0 | 425ms | 441ms | 560ms | 571ms | 607ms | 607ms |

## Next Steps

- Keep image write instrumentation; async image persistence is not urgent from this run alone.
- Proceed to 1/5/10 real-browser model ramp after this script is stable.
- If 50-concurrency writes pass repeatedly but p95 grows at 100 users, evaluate PostgreSQL or a queue-backed write path.

## Cleanup

Dry run:

```
node scripts/cleanup-load-test-data.js --runId loadtest-d-v1.5.1-release
```

Apply cleanup:

```
node scripts/cleanup-load-test-data.js --runId loadtest-d-v1.5.1-release --yes
```
