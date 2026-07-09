# Birdora 真实浏览器识别并发 Ramp 报告

- 测试日期：2026-07-03
- 测试目标：验证真实 Chrome/CDP 标签页同时加载页面、加载 ONNX/WASM、上传样例鸟图并执行识别。
- Web 服务：脚本自动启动本地 `public/` 静态服务，随机本地端口。
- API 服务：脚本自动启动本地隔离 API，使用临时 SQLite、临时上传目录；未对生产写入。
- 浏览器：本机 Chrome/Edge CDP，headless new，每个 ramp 使用全新临时 Chrome profile。
- 样例图：`./assets/birds/kingfisher.jpg`
- 结果 JSON：
  - `docs/browser-recognition-ramp-results-desktop.json`
  - `docs/browser-recognition-ramp-results-mobile.json`

## 方法

新增脚本 `scripts/test-browser-recognition-ramp.js` 通过 CDP 打开真实页面，向 `#birdUpload` 注入真实 `File` 对象并触发 `change` 事件，走页面现有路径：

```text
文件选择 -> 对象 URL 预览 -> classifyImageElement() -> ONNX Runtime WASM -> bird_model.onnx -> bird_info.json -> Top 5 渲染
```

每个标签页执行两次识别：

1. 首次识别：冷页面，包含模型、WASM、标签加载和首次 ONNX session 初始化。
2. 二次识别：同一页面复用已加载模型和标签，衡量热路径推理。

## 桌面结果

视口：`1366 x 768`

| 并发标签页 | 首次成功 | 首次 p50 | 首次 p95 | 首次 max | 二次成功 | 二次 p50 | 二次 p95 | 二次 max | 控制台 error | 崩溃/卡死 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1/1 | 701ms | 701ms | 701ms | 1/1 | 179ms | 179ms | 179ms | 0 | 0 |
| 5 | 5/5 | 1678ms | 2032ms | 2032ms | 5/5 | 276ms | 289ms | 289ms | 0 | 0 |
| 10 | 10/10 | 3077ms | 4034ms | 4034ms | 10/10 | 499ms | 626ms | 626ms | 0 | 0 |
| 20 | 20/20 | 7434ms | 8671ms | 8932ms | 20/20 | 1217ms | 1491ms | 1512ms | 0 | 0 |

桌面 20 并发资源下载 p95：

| 资源 | p95 |
| --- | ---: |
| `bird_model.onnx` | 2178ms |
| `ort-wasm-simd-threaded.wasm` | 1338ms |
| `bird_info.json` | 11ms |

## 移动视口结果

视口：`390 x 844`，移动 UA，DPR 3

| 并发标签页 | 首次成功 | 首次 p50 | 首次 p95 | 首次 max | 二次成功 | 二次 p50 | 二次 p95 | 二次 max | 控制台 error | 崩溃/卡死 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 5/5 | 2096ms | 2372ms | 2372ms | 5/5 | 312ms | 328ms | 328ms | 0 | 0 |
| 10 | 10/10 | 3079ms | 4520ms | 4520ms | 10/10 | 393ms | 563ms | 563ms | 0 | 0 |

## 识别正确性

所有完成的识别均返回同一 Top 1：

```text
普通翠鸟 / Common Kingfisher / Alcedo atthis
OSEA index: 3334
confidence: 94.03%
mapped: true
local atlas match: true
```

## 结论

- 5 并发真实浏览器识别：通过。
- 10 并发真实浏览器识别：通过。
- 20 并发真实浏览器识别：桌面通过。
- 移动视口已覆盖 5 和 10 并发，通过。
- 失败率：0%。
- 控制台 error：0。
- 页面崩溃/卡死：0。

瓶颈主要不是标签 JSON，也不只是模型静态下载；20 并发下首次识别 p95 为 8671ms，而模型资源下载 p95 为 2178ms，说明主要尾延迟来自每个标签页并发创建 ONNX Runtime session、WASM 初始化和 CPU 推理竞争。

当前 60 秒模型加载超时没有触发，loading 文案在测试期间能持续更新，暂未发现需要立即修复的前端 loading、超时、缓存或模型失败提示问题。

## 建议

- 现场演示建议预热：让讲解设备或现场浏览器提前完成一次识别，二次识别 p95 可从桌面 20 并发的 8671ms 降到 1491ms。
- 对公开试用仍建议保留当前保守文案：首次使用会加载模型，可能需要更久。
- 如果预计 20+ 用户同时首次识别，建议增加显式“准备模型/预加载模型”入口，或在用户进入识别区后空闲预取 ONNX/WASM/标签。
- 静态资源缓存策略当前可用；`assets/` 已由本地静态服务返回长期缓存头，二次识别瓶颈已转为热路径推理。

## 复现命令

```text
node scripts/test-browser-recognition-ramp.js
```

本次分开执行：

```text
$env:BIRD_RECOGNITION_RAMPS='1,5,10,20'
$env:BIRD_RECOGNITION_MOBILE_RAMPS=''
$env:BIRD_RECOGNITION_REPORT_JSON='docs/browser-recognition-ramp-results-desktop.json'
node scripts/test-browser-recognition-ramp.js

$env:BIRD_RECOGNITION_RAMPS=''
$env:BIRD_RECOGNITION_MOBILE_RAMPS='5,10'
$env:BIRD_RECOGNITION_REPORT_JSON='docs/browser-recognition-ramp-results-mobile.json'
node scripts/test-browser-recognition-ramp.js
```
