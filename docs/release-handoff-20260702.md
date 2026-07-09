# Birdora 1.4.0 发布交接日志

更改日期：2026-07-02

目标峰值日期：2026-07-03

## 1. 版本信息

```text
version: 1.4.0
tag: v1.4.0
branch: fix/ui-a11y-audit-hardening
remote: deploy-temp / https://github.com/muchensu77-create/birdora-web-deploy.git
release owner: muchensu77-create
collaboration account: Leolee14529
```

说明：本日志记录本地新版本发布到 GitHub 前的交接口径。最终提交号以 `v1.4.0` 标签和 GitHub Release 为准。

## 2. 协作规定

- 以后接手本仓库先读 `AGENTS.md`，再读本文和最新上线准备报告。
- 根目录 HTML/CSS/JS 是源文件，`public/` 是发布目录。
- 修改根目录前端源文件后必须运行 `pnpm sync:public`。
- 只能托管 `public/`，不要把项目根目录作为静态站点暴露。
- 不要提交 `app/data/`、SQLite 文件、上传图片目录、日志或依赖目录。
- 不要停止或修改同服务器上的无关服务。
- 对外宣传必须保守：可以说 50 人轻量试用准备完成，不能说完整生产峰值、真实浏览器 50 人并发、5 人同时识别、AI 改写/审核模型都已覆盖。

## 3. 本版交付内容

- 新增 `AGENTS.md` 作为接手入口和协作规则。
- 新增上线准备检测计划、执行报告、八路审核报告、峰值准备报告和峰值交接文档。
- 社区帖子支持图片、评价、评论、提问、分页、作者编辑/删除、非作者权限拦截。
- 后端为图文内容生成轻量规则文案分析，并持久化评分、摘要、标签和建议。
- 社区图片默认跟随 SQLite 数据目录保存，也可用 `COMMUNITY_UPLOAD_DIR` 指定。
- 图片上传新增类型和真实文件头校验，删除帖子时同步清理图片。
- 新增社区写限流、Nginx 上传大小和基础安全响应头。
- 新增可重复测试入口：`test:browser`、`test:community`、`test:peak`、`test:prod:readonly`。
- README、部署文档、Docker、Compose 和 Nginx 模板已更新到社区 API 和上线准备口径。

## 4. 验证口径

发布前至少执行：

```text
pnpm sync:public
pnpm test:auth
pnpm test:browser
pnpm test:community
pnpm test:atlas
pnpm test:peak
pnpm test:prod:readonly
node --check server.js
node --check script.js
node --check public/script.js
git diff --check
```

如果 `pnpm test:prod:readonly` 因公网、DNS、证书或相邻服务临时不可达失败，必须在最终交接里写明。

### 4.1 本次发布验证记录

本次 `v1.4.0` 发布前已执行：

```text
pnpm sync:public
pnpm test:auth
pnpm test:browser
pnpm test:community
pnpm test:atlas
pnpm test:peak
pnpm test:prod:readonly
node --check server.js
node --check script.js
node --check public/script.js
node --check app/controllers/auth.controller.js
node --check app/controllers/community-post.controller.js
node --check app/db/database.js
node --check app/middleware/auth-jwt.js
node --check app/routes/auth.routes.js
node --check app/routes/community-post.routes.js
node --check app/services/community-post.service.js
node --check scripts/test-auth.js
node --check scripts/test-browser-e2e.js
node --check scripts/test-community.js
node --check scripts/test-peak.js
node --check scripts/test-production-readonly.js
git diff --check
```

结果：

```text
auth: PASS
browser E2E: PASS
community API: PASS
atlas data: PASS with 1 known OSEA label-count warning
peak 50-user light API rehearsal: PASS
production readonly: PASS
diff whitespace check: PASS, Windows LF/CRLF notices only
```

最新峰值摘要：

```text
50 users browse community list: failures=0, p95=37ms
10 users publish posts: failures=0, p95=16ms
3 uploaded post images are readable: failures=0, p95=3ms
20 users react to one post: failures=0, p95=30ms
20 users comment on one post: failures=0, p95=31ms
10 users ask questions: failures=0, p95=19ms
50 users refresh community list: failures=0, p95=51ms
```

## 5. 已知限制

- OSEA 标签文件仍是 10,964 条，模型观测输出是 11,000 维。
- `pnpm test:peak` 是轻量社区 API 峰值演练，不代表真实浏览器 50 人并发。
- 尚未覆盖 5 人同时鸟类识别、ONNX/WASM 首载并发和真实 1MB 大图集中上传。
- 文案分析是规则 MVP，不是独立 AI 改写、审核或多版本生成模型。
- 生产数据目录需要备份 SQLite、WAL、SHM 和 `uploads/community/`。

## 6. 发布后交接

发布完成后最终回复必须记录：

- GitHub Release URL。
- release commit。
- tag。
- 分支和远端。
- 已运行验证。
- 协作账号权限状态。
- 仍需人工确认的事项。
