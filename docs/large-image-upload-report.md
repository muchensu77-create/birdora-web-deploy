# Birdora Large Image Upload Report

- Test time: 2026-07-03T13:32:41.842Z - 2026-07-03T13:32:49.308Z
- runId: `large-image-1783085561842`
- status: `passed`
- API_BASE_URL: `http://127.0.0.1:53430`
- users: `50`
- image bytes: `524288-1024000`
- DATABASE_FILE isolated: `true` (C:\Users\Administrator\AppData\Local\Temp\birdora-load-test-v160-verify-1783085537114\birdora-load-test-verify.sqlite)
- COMMUNITY_UPLOAD_DIR isolated: `true` (C:\Users\Administrator\AppData\Local\Temp\birdora-load-test-v160-verify-1783085537114\load-test-community-uploads)
- OBSERVATION_UPLOAD_DIR isolated: `true` (C:\Users\Administrator\AppData\Local\Temp\birdora-load-test-v160-verify-1783085537114\load-test-observation-uploads)
- image write metrics captured: `false` ()

## Request Latency

| Name | Total | Success | Failures | 5xx | SQLITE_BUSY | Timeout | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall uploads | 100 | 100 | 0 | 0 | 0 | 0 | 266ms | 251ms | 351ms | 383ms | 402ms | 407ms |
| community posts | 50 | 50 | 0 | 0 | 0 | 0 | 279ms | 271ms | 383ms | 396ms | 407ms | 407ms |
| observations | 50 | 50 | 0 | 0 | 0 | 0 | 254ms | 238ms | 317ms | 328ms | 336ms | 336ms |

## Disk Write Latency

| Name | Total | Failures | Avg | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall image writes | 0 | 0 | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |
| community image writes | 0 | 0 | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |
| observation image writes | 0 | 0 | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |

## Error Samples

No unexpected errors captured.
