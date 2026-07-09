# Birdora 1.5.0 发布交接日志

更改日期：2026-07-02

目标峰值日期：2026-07-03

## 1. 版本信息

```text
version: 1.5.0
tag: v1.5.0
branch: fix/ui-a11y-audit-hardening
remote: deploy-temp / https://github.com/muchensu77-create/birdora-web-deploy.git
release owner: muchensu77-create
collaboration account: Leolee14529
```

说明：本日志记录 `1.5.0` 的版本管理、协作、验证和剩余风险。最终提交号以 `v1.5.0` 标签和 GitHub Release 为准。

## 2. 本版主线

本版是较大更新，重点从“社区图文发布”推进到“识别结果可保存为个人观测记录，并可关联发布到社区”。

已加入：

- 认证用户可保存鸟类识别结果为 observation。
- Observation 持久化保存识别图片、选中鸟种、置信度、Top 5 候选、位置、备注、来源和观察时间。
- Observation 图片使用独立上传目录，默认跟随 SQLite 数据目录，也可用 `OBSERVATION_UPLOAD_DIR` 指定。
- Observation 只允许本人读取、查看图片和删除。
- 已关联社区帖子的 observation 删除会返回 409，避免断链。
- 社区帖子可关联本人 observation，不能关联他人或不存在的 observation。
- 前端新增保存识别结果、观测历史、从观测发布社区内容和详情展示。
- 社区评论支持分页读取和删除。
- 新增 Origin 写保护、请求 ID、结构化错误日志和敏感内容脱敏。
- 新增性能测试计划、性能报告 JSON/Markdown 和 load-test 数据清理脚本。

## 3. 协作规定

- 后续接手先读 `AGENTS.md`，再读本文和 `docs/performance-report.md`。
- 根目录 HTML/CSS/JS 是源文件，`public/` 是发布目录。
- 修改根目录前端源文件后必须运行 `pnpm sync:public`。
- 不要提交 SQLite、上传图片、日志、`node_modules/` 或 load-test 数据。
- 写入压测只能使用隔离数据库和隔离上传目录，不能直接打正式生产。
- 生产检查保持只读，写测试必须在本地或隔离 staging。
- 对外仍不能宣称完整生产峰值已覆盖；当前是 50 并发脚本压测和浏览器 E2E 覆盖。

## 4. 已知风险

- `docs/performance-report.md` 状态为 `completed_with_findings`。
- 负载测试没有 5xx、429 或 timeout，写入成功率为 100%。
- 但整体 API p95 阈值未达标，主要被注册/登录尾延迟拉高。
- OSEA 标签仍是 10,964 条，模型观测输出是 11,000 维。
- 文案分析仍是规则 MVP，不是独立 AI 改写或审核模型。
- 50 并发模型资源下载已测，但仍不是 50 个真实浏览器同时执行 ONNX 推理。

## 5. 发布前验证清单

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
node --check server.js
node --check script.js
node --check public/script.js
git diff --check
```

### 5.1 本次验证记录

本次 `v1.5.0` 发布前已执行：

```text
pnpm sync:public
pnpm test:auth
pnpm test:browser
pnpm test:community
pnpm test:observations
pnpm test:atlas
pnpm test:peak
pnpm test:prod:readonly
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
production readonly: PASS
diff whitespace check: PASS, Windows LF/CRLF notices only
peak/load test: completed with findings
```

`pnpm test:peak` 的业务结果：

```text
total requests: 1464
success: 1464
5xx: 0
429: 0
timeouts: 0
write business success rate: 100%
overall API p95: about 3.2s
```

说明：`pnpm test:peak` 返回非 0 是预期的阈值失败信号，因为 `API p95 < 1000ms` 未达标。报告文件见：

```text
docs/performance-report.md
docs/performance-report.json
```

## 6. 发布后交接要求

最终回复必须记录：

- GitHub Release URL。
- release commit。
- tag。
- 分支和远端。
- 已运行验证。
- 协作账号权限状态。
- 未解决风险和下一步建议。
