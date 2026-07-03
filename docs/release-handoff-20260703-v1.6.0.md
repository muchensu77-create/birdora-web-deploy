# Birdora 1.6.0 发布交接日志

更改日期：2026-07-03

目标峰值日期：2026-07-03

## 1. 版本信息

```text
version: 1.6.0
tag: v1.6.0
branch: fix/ui-a11y-audit-hardening
remote: deploy-temp / https://github.com/muchensu77-create/birdora-web-deploy.git
release owner: muchensu77-create
collaboration account: Leolee14529
base release: v1.5.1 / 053ad42
```

说明：本日志记录 `1.6.0` 的版本管理、协作、验证和剩余风险。最终提交号以 `v1.6.0` 标签和 GitHub Release 为准。

## 2. 本版主线

本版是 2026-07-03 试用日之前的一次大版本硬化，重点是把识别、上传、认证尾延迟和真实浏览器压测进一步补齐。

发布链路已先接入远端 `v1.5.1`，再在其后发布 `v1.6.0`，避免覆盖 favicon、MIME、Nginx 和识别加载态修复。

已加入：

- 服务端 OSEA 识别接口：`POST /api/recognition/classify`。
- `onnxruntime-node` + `jpeg-js` 的服务端 JPEG 预处理和 Top 5 映射。
- HEIC 转换静态依赖，兼容手机相册常见格式入口。
- 密码哈希/验证 worker pool，降低 50 并发注册/登录尾延迟。
- 大图上传压测和 image write metrics。
- 真实浏览器识别 ramp：桌面 1/5/10/20 并发，移动 5/10 并发。
- 50 sub-agent 浏览器流程汇总报告。
- 写测试安全工具，避免误打生产写入目标。
- 原始浏览器代理结果目录已加入 `.gitignore`，版本内保留汇总报告。

## 3. 验证结果摘要

最新报告：

```text
docs/performance-report.md
docs/browser-50-agent-flow-report.md
docs/browser-recognition-ramp-report-20260703.md
docs/large-image-upload-report.md
```

关键结论：

```text
50-concurrency API/load report: passed
total requests: 1514
success: 1514
5xx: 0
429: 0
timeout: 0
API p95 threshold: PASS
large image uploads: PASS, 100/100
50 sub-agent browser flow: PASS, 50/50
real-browser recognition ramp: PASS for desktop 1/5/10/20 and mobile 5/10
```

## 4. 协作规定

- 后续接手先读 `AGENTS.md`，再读本文和最新报告。
- 根目录 HTML/CSS/JS 是源文件，`public/` 是发布目录。
- 修改根目录前端源文件后必须运行 `pnpm sync:public`。
- 不要提交 SQLite、上传图片、日志、`node_modules/`、原始 browser agent 结果目录。
- 写入压测只能使用隔离数据库和隔离上传目录，不能直接打正式生产。
- 生产检查保持只读，写测试必须在本地或隔离 staging。

## 5. 已知限制

- OSEA 标签仍是 10,964 条，模型观测输出是 11,000 维。
- 真实浏览器识别 ramp 通过，但仍是本机 Chrome/CDP 环境，不等同于现场所有用户设备和网络。
- 20 并发首次识别 p95 约 8.7s，建议现场预热模型。
- 文案分析仍是规则 MVP，不是独立 AI 改写或审核模型。
- 服务端识别目前只接受 JPEG data URL，前端兼容和 HEIC 转换路径仍需持续现场复核。

## 6. 发布前验证清单

发布前至少执行并记录：

```text
pnpm sync:public
pnpm test:auth
pnpm test:browser
pnpm test:community
pnpm test:observations
pnpm test:atlas
pnpm test:peak
pnpm test:prod:readonly
pnpm test:recognition:server
pnpm test:large-images
node --check for project JS files
git diff --check
```

### 6.1 本次发布验证记录

本次 `v1.6.0` 发布前已执行：

```text
pnpm sync:public
pnpm test:auth
pnpm test:browser
pnpm test:community
pnpm test:observations
pnpm test:atlas
pnpm test:peak
pnpm test:recognition:server
pnpm test:large-images
node --check for project JS files
git diff --check
```

结果：

```text
auth: PASS
browser E2E: PASS
community API: PASS
observations API: PASS
atlas data: PASS with 1 known OSEA label-count warning
server recognition: PASS
peak/load test: PASS
large image upload: PASS on isolated load-test API
diff whitespace check: PASS, Windows LF/CRLF notices only
```

`pnpm test:peak` 最新摘要：

```text
total requests: 1514
success: 1514
5xx: 0
429: 0
timeouts: 0
write business success rate: 100%
API p95 threshold: PASS, p95 about 832ms
```

`pnpm test:large-images` 最新摘要：

```text
users: 50
overall uploads: 100/100
overall upload p95: 383ms
disk write metrics: not captured in the final external-process rerun
```

生产只读复核：

```text
pnpm test:prod:readonly: partial / needs rerun
site home: PASS
api health: PASS
server source hidden: PASS
sqlite hidden: PASS
env hidden: PASS
osea model reachable: PASS
script failed later with Node fetch failed
manual Invoke-WebRequest home: HTTP 200
manual Invoke-WebRequest ort wasm: HTTP 200
manual Invoke-WebRequest neighbor service: HTTP 200
```

说明：生产只读脚本的失败表现为本机 Node `fetch failed`，而不是已确认的站点 5xx。正式部署前仍建议重新跑一次 `pnpm test:prod:readonly`。

## 7. 发布后交接要求

最终回复必须记录：

- GitHub Release URL。
- release commit。
- tag。
- 分支和远端。
- 已运行验证。
- 协作账号权限状态。
- 未解决风险和下一步建议。
