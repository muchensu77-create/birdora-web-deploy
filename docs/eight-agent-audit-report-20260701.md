# Birdora 8 路专项审核汇总报告

日期：2026-07-01

目标峰值日期：2026-07-03

## 总结论

当前版本对“两天后 50 人轻量网页试用”判定为：有条件通过。

可以支撑：

- 账号注册、登录、登出。
- 首页和社区页浏览。
- 图文文案发布。
- 跨账号浏览、评价、评论、提问。
- 作者编辑、删除自己的帖子。
- 非作者编辑、删除被后端拒绝。
- 50 人轻量社区 API 峰值演练。

不能夸大为：

- 完整真实浏览器 50 人峰值已覆盖。
- 5 人同时鸟类识别已压测。
- OSEA 11,000 输出类已全量标签覆盖。
- 已有独立 AI 文案分析、改写、审核模型。目前只有轻量规则分析 MVP。
- Docker/compose 已可直接完整托管网页。

## 8 个方向结论

| 方向 | 状态 | 关键结论 |
| --- | --- | --- |
| 1. 功能闭环 | 有条件通过 | 核心社区闭环已跑通，已补轻量文案分析，仍缺浏览器 E2E 和独立 AI 分析。 |
| 2. 数据库与持久化 | 有条件通过 | SQLite 持久化可用；图片目录已改为跟随数据库目录。 |
| 3. 鸟类识别 | 有条件通过 | OSEA 浏览器本地推理可演示；10,964 vs 11,000 标签差异仍需说明。 |
| 4. 性能与 50 人峰值 | 有条件通过 | `test:peak` 是轻量社区 API 峰值，已覆盖少量带图发布和图片读取，不覆盖模型首载。 |
| 5. 安全与权限 | 有条件通过 | 作者权限、CORS、cookie、XSS 转义基本可用；已补社区写限流和图片内容校验。 |
| 6. 移动端体验 | 有条件通过 | 主要宽度无页面级横向溢出；已修评论按钮和极窄屏顶部按钮高度。 |
| 7. 部署与运维 | 有条件通过 | PM2 + Nginx 路线可用；Docker/compose 仍只是 API 服务，不是完整网页部署。 |
| 8. 测试与文档 | 有条件通过 | 已补充本报告和交接入口；文案分析状态必须持续醒目标注。 |

## 本轮已修复

- 社区图片默认保存到数据库同级持久化目录：`<database-dir>/uploads/community`。
- `COMMUNITY_UPLOAD_DIR` 可显式指定社区图片目录。
- 帖子创建失败时会清理已写入的图片文件。
- 上传图片新增真实文件头校验，伪装成图片的文本会被拒绝。
- 社区写接口新增登录用户维度限流，默认 `240 / 15min`。
- 认证限流默认从 `30 / 15min` 调整为 `120 / 15min`，降低 50 人集中登录误伤。
- 文案分析新增规则 MVP，发布和编辑时持久化评分、摘要、标签、建议。
- 社区列表 API 新增 `limit` / `offset` 分页，前端社区页支持加载更多。
- 鸟类识别 Top 1 未映射时不再进入“可信成功”状态。
- 评论按钮和极窄屏顶部操作按钮保持不低于 44px。
- Nginx 模板补充 `client_max_body_size 3m` 和基础安全响应头。
- `test:community` 补充未登录写入、坏图片、非作者删除、删除后图片 404。

## 复测结果

通过：

```text
pnpm test:auth
pnpm test:community
pnpm test:atlas
pnpm test:peak
```

`test:atlas` 仍有 1 个警告：

```text
bird_info.json contains 10964 labels, but the current OSEA model has been observed returning 11000 logits.
```

最新隔离数据库 50 人轻量社区 API 峰值结果：

```text
50 users browse community list: failures=0, p95=26ms
10 users publish posts: failures=0, p95=22ms
3 uploaded post images are readable: failures=0, p95=6ms
20 users react to one post: failures=0, p95=36ms
20 users comment on one post: failures=0, p95=40ms
10 users ask questions: failures=0, p95=20ms
author edits own post: failures=0, p95=2ms
non-author edit is rejected: failures=0, p95=2ms
50 users refresh community list: failures=0, p95=47ms
Peak test result: PASS
```

浏览器抽查：

- 首页真实发布成功。
- 社区页能看到真实持久化帖子。
- 评论和提问面板可展开。
- 评论和提问可提交并回显。
- 评论按钮实测 44px。
- 社区页顶部操作按钮实测 48px。
- 控制台无 error / warning。

## 剩余 P1

- 真实浏览器 E2E 未自动化，建议补 `login -> publish -> community -> comment/question -> edit/delete`。
- `test:peak` 未覆盖首页静态资源、ONNX/WASM 首载和 5 人同时识别；带图发布只覆盖 3 张 tiny PNG，仍不是大图峰值。
- 社区列表无分页，帖子和互动增长后需要分页或懒加载。
- 图片由 Node API 发送，带图帖子大量浏览时仍应压测。
- 独立 AI 文案分析能力未接入；当前是规则分析 MVP。
- 生产部署前必须提交或打包本轮改动，避免服务器只拉到旧 `v1.3.0`。

## 两天后使用建议

按小规模演示和轻量试用推进：可以。

对外承诺为完整生产峰值：不建议。

正式使用当天建议：

1. 生产环境先跑 `pnpm test:auth`、`pnpm test:community`。
2. 用临时测试账号跑一次 50 人轻量峰值。
3. 预热首页静态资源和 OSEA 模型资源。
4. 限制单图 1MB，不鼓励集中上传大图。
5. 把 `/var/lib/birdora/` 整目录纳入备份，包含 SQLite 和 `uploads/community`。
