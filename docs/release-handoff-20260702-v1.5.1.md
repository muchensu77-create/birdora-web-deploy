# Birdora 1.5.1 发布交接日志

记录日期：2026-07-02

## 1. 版本信息

```text
version: 1.5.1
tag: v1.5.1
branch: fix/ui-a11y-audit-hardening
remote: origin / https://github.com/muchensu77-create/birdora-web-deploy.git
```

## 2. 本版范围

- 修复生产 Nginx 返回 `.mjs` 错误 MIME 导致 ONNX Runtime 动态导入失败的问题。
- 为 `.mjs` 增加独立 MIME、无缓存和 stale conditional request 防回归检查。
- 将 `.mjs` 纳入模型静态资源压测。
- 优化识别状态：识别中图片灰化并显示居中转圈；结束后恢复原图且不保留遮罩。
- 用站内一致的图片选择器替换社区发布表单的浏览器原生文件控件。
- 修复发布表单操作区越界，并补充手机、平板和桌面响应式规则。
- 新增 Birdora 品牌 favicon，并覆盖首页、登录、社区、隐私政策和用户协议页面。
- 本地静态服务器增加 SVG MIME；Nginx 静态资源缓存规则增加 SVG。

## 3. 发布边界

以下本地内容不属于本版，不提交、不部署：

- `app/db/database.js`
- `.DS_Store`
- `test-fixtures/`

## 4. 验证结果

隔离环境：

```text
API: http://127.0.0.1:4620
Web: http://127.0.0.1:4621
Database/uploads: isolated temporary directory
```

结果：

```text
dependency install: PASS
auth API: PASS
community API: PASS
observations API: PASS
browser E2E: PASS
atlas validation: PASS with 1 known 10,964 vs 11,000 warning
JavaScript syntax checks: PASS
production dependency audit: PASS, no known vulnerabilities
git diff whitespace check: PASS
```

50 并发性能复测：

```text
total requests: 1514
success: 1514
failures: 0
5xx: 0
429: 0
timeouts: 0
write business success rate: 100%
overall p95: 2945ms
API p95: 3513ms (threshold < 1000ms: FAIL)
model static downloads: 200/200 success, p95 962ms
```

`pnpm test:peak` 因既有 API p95 阈值未达标返回非零；业务正确性、错误率和超时指标均通过。完整数据见 `docs/performance-report.md` 和 `docs/performance-report.json`。

部署前生产只读检查预期在 favicon 项失败，因为该静态资源尚未部署；部署后必须重新执行并全部通过。

## 5. 部署和回滚

- 仅从 `v1.5.1` 提交构建部署包，避免带入本地保留改动。
- 先备份生产目录和独立 Birdora Nginx server block。
- 对 staging 目录执行依赖安装、`pnpm sync:public`、语法检查和 `nginx -t`。
- 原子切换后仅 reload Nginx；本版无后端逻辑和数据库结构变更，不需要重启 PM2。
- 回滚时恢复上一版代码目录和 Nginx 配置，再 reload Nginx。

## 6. 部署后验收

- `pnpm test:prod:readonly` 全部通过。
- favicon 返回 `200` 且 MIME 为 `image/svg+xml`。
- `.mjs` 返回 `application/javascript`，无 ETag，stale conditional request 仍返回 `200`。
- WASM 返回 `application/wasm`。
- 首页、登录、社区、识别流程和相邻 `jewelry-api` 无回归。
- 浏览器标签栏显示 Birdora 绿色 `B` 图标。

## 7. 保留风险

- 50 并发业务无失败，但注册和登录尾延迟仍使 API p95 超过 1 秒目标。
- 未覆盖 50 个真实浏览器同时执行 ONNX 推理。
- OSEA 标签仍为 10,964 条，对应已观察到的 11,000 维输出仍缺 36 条映射。
- 文案分析仍是规则 MVP，不是独立 AI 改写或审核模型。
