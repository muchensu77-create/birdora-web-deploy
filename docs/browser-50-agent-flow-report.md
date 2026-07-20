# Birdora 50-User Browser Journey Report

- Generated at: 2026-07-20T03:41:18.364Z
- Expected user journeys: 50
- Maximum concurrent browsers: 5
- Observed result files: 50
- Passed: 50
- Failed: 0
- Missing: 0
- Overall: PASS
- Result directory: `C:\Users\Administrator\Documents\逸轩_开发\worktrees\birdora-web-backend\docs\browser-50-agent-results\browser50-journeys-v172-release-20260720`

## Phase Summary

| Phase | Passed | Failed | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| register | 50/50 | 0 | 1654ms | 8849ms | 8990ms | 8990ms |
| logout | 50/50 | 0 | 1111ms | 2452ms | 8104ms | 8104ms |
| login | 50/50 | 0 | 1779ms | 6615ms | 7403ms | 7403ms |
| recognition | 50/50 | 0 | 7326ms | 16224ms | 35139ms | 35139ms |
| observationSaveRefresh | 50/50 | 0 | 1384ms | 3752ms | 7560ms | 7560ms |
| publishPost | 50/50 | 0 | 965ms | 4519ms | 6410ms | 6410ms |
| commentUi | 50/50 | 0 | 1588ms | 3482ms | 6586ms | 6586ms |

## Recognition

- Status counts: `{"success":50}`
- Total p95: 12467ms
- Classify p95: 12434ms
- Top labels: `{"普通翠鸟 / Common Kingfisher":50}`

| Resource | Count | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| bird_info.json | 50 | 41ms | 492ms | 981ms |
| bird_model.onnx | 50 | 2468ms | 7011ms | 8287ms |
| ort-wasm-simd-threaded.wasm | 50 | 572ms | 4403ms | 7861ms |

## Browser Diagnostics

- Console errors: 0
- Console warnings: 0
- Exceptions: 0
- Network failures: 0
- API network failures: 0
- Crashes: 0
- Diagnostics gate: PASS
