# Birdora 上线准备执行报告

日期：2026-07-02

目标峰值日期：2026-07-03

## 1. 执行结论

当前版本判断为：可演示，偏可上线。

可以支撑 50 人轻量网页试用中的核心流程：

- 注册、登录、退出。
- 首页浏览、社区浏览。
- 作者发布图文文案。
- 读者跨账号查看、评价、评论、提问。
- 作者编辑自己的帖子。
- 后端强制拒绝非作者编辑和删除。
- 社区 API 50 人轻量峰值演练。

仍不能宣称完整生产峰值已覆盖，原因是：

- 真实浏览器 50 人并发未覆盖。
- ONNX/WASM 首载并发未覆盖。
- 5 人同时鸟类识别未覆盖。
- 真实 1MB 大图集中上传和大量图片浏览未覆盖。
- OSEA 标签仍是 10,964 条，模型观测输出是 11,000 维。
- 文案分析仍是规则 MVP，不是独立 AI 改写、审核或审核模型。

## 2. 版本和环境

本地项目路径：

```text
C:\Users\Administrator\Documents\逸轩_开发\website\birdora-web
```

分支和提交：

```text
branch: fix/ui-a11y-audit-hardening
commit: d8a6db7
```

远端：

```text
origin: https://github.com/yuki-liuk/birdora-web.git
deploy-temp: https://github.com/muchensu77-create/birdora-web-deploy.git
```

本地环境：

```text
Node.js: v25.2.1
pnpm: 11.7.0
```

说明：工作区存在多项既有未提交改动，本次新增和修改范围见本文末尾。

## 3. 本轮执行项

### 3.1 语法和格式

已通过：

```text
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
node --check scripts/static-server.js
node --check scripts/sync-public.js
node --check scripts/test-auth.js
node --check scripts/test-community.js
node --check scripts/test-peak.js
git diff --check
```

`git diff --check` 仅输出 Windows 换行提示，未发现空白格式错误。

### 3.2 图鉴和识别资源

已通过：

```text
pnpm test:atlas
```

结果：

```text
Atlas data validation: 13 profiles, 100 candidates, 0 errors, 1 warnings.
```

仍有既有警告：

```text
bird_info.json contains 10964 labels, but the current OSEA model has been observed returning 11000 logits.
```

识别首载关键资源已检查：

```text
ort.min.js: 446,284 bytes
ort-wasm-simd-threaded.wasm: 11,246,032 bytes
ort-wasm-simd-threaded.mjs: 24,618 bytes
bird_model.onnx: 27,241,841 bytes
bird_info.json: 712,908 bytes
```

WASM 魔数检查：

```text
00 61 73 6d
```

### 3.3 隔离数据库 API 测试

使用临时 SQLite 和临时上传目录执行，不污染现有数据。

已通过：

```text
pnpm test:auth
pnpm test:browser
pnpm test:community
pnpm test:peak
pnpm test:prod:readonly
```

认证测试覆盖：

- 注册。
- 登录。
- JWT 不出现在 JSON 响应。
- Cookie 登录态。
- `/api/auth/me`。
- `/api/auth/status`。
- 退出后 token 失效。

社区测试覆盖：

- 未登录发帖被 401 拒绝。
- A/B 账号注册登录。
- 作者发布图文。
- 文案分析生成。
- 图片接口可读取。
- 读者可浏览作者帖子。
- 读者不能编辑和删除作者帖子。
- 读者可评价、评论、提问。
- 作者可编辑自己的帖子。
- 作者可删除自己的帖子。
- 删除后图片返回 404。

最新 50 人轻量峰值结果：

```text
50 users browse community list: failures=0, p95=38ms
10 users publish posts: failures=0, p95=21ms
3 uploaded post images are readable: failures=0, p95=2ms
20 users react to one post: failures=0, p95=33ms
20 users comment on one post: failures=0, p95=42ms
10 users ask questions: failures=0, p95=21ms
author edits own post: failures=0, p95=3ms
non-author edit is rejected: failures=0, p95=1ms
50 users refresh community list: failures=0, p95=54ms
Peak test result: PASS
```

### 3.4 真实浏览器主流程

使用本地 Chrome / 应用内浏览器和隔离 API 执行。当前已沉淀为可重复命令：

```text
pnpm test:browser
```

已完成：

- 作者通过登录页真实 UI 注册。
- 作者登录后跳转首页。
- 作者通过首页发布表单发布观鸟笔记。
- 首页 feed 回显新帖。
- 社区页作者视角可见新帖和管理入口。
- 读者通过登录页真实 UI 注册。
- 读者社区页可见作者帖子。
- 读者视角没有作者帖子的修改/删除入口。
- 读者评价成功。
- 读者评论成功。
- 读者提问成功。
- 作者重新登录后可见读者评价、评论、提问。
- 作者通过社区页真实 UI 编辑帖子。
- 编辑后标题、正文、文案分析分数更新，互动保留。
- 作者通过社区页真实 UI 删除帖子。

数据库核对结果：

```text
browser author user: present
browser reader user: present
browser post: present
edited title/body: present
reaction helpful count: 1
comments: 1
questions: 1
```

新增脚本保护：

- `pnpm test:browser` 会创建测试账号和帖子，默认拒绝非本地地址。
- 如需指向隔离远程测试环境，必须显式设置 `ALLOW_REMOTE_BROWSER_E2E=1`。

### 3.5 移动端和桌面尺寸

使用本地 Chrome 调试接口检查页面级横向溢出和可点击控件高度。

覆盖页面：

```text
/
/login.html
/community.html
/privacy.html
/terms.html
```

覆盖尺寸：

```text
360 x 800
375 x 667
390 x 844
414 x 896
430 x 932
768 x 1024
1366 x 768
```

初测发现：

- 首页图鉴“查看详情”按钮高度约 22px。
- 登录页“去注册”按钮高度约 25px。
- 社区评价按钮在部分宽度约 36px。
- 首页社区“更多”按钮高度约 42px。

本轮已修复并复测：

- `styles.css`：图鉴来源/详情按钮最小高度提升到 44px。
- `styles.css`：登录/注册切换按钮最小高度提升到 44px。
- `styles.css`：首页社区“更多”按钮最小高度提升到 44px。
- `community-post-card.css`：社区评价按钮最小高度提升到 44px。
- 已运行 `pnpm sync:public` 同步到 `public/`。

复测结果：

```text
360 / 390 / 768 / 1366 宽度下：
home/login/community 均无横向溢出
可点击控件未再发现低于 44px
```

### 3.6 正式站点只读检查

已执行只读检查，未对生产写入测试数据。当前已沉淀为可重复命令：

```text
pnpm test:prod:readonly
```

结果：

```text
https://birdora.birdai-glasses.com/                       200
https://birdora.birdai-glasses.com/api/health             200
https://birdora.birdai-glasses.com/server.js              404
https://birdora.birdai-glasses.com/app/data/birdora.sqlite 404
https://birdora.birdai-glasses.com/.env                   404
https://jewelry-api.birdai-glasses.com/                   200
```

生产 OSEA 资源只读检查：

```text
bird_model.onnx: 200, 27,241,841 bytes
ort-wasm-simd-threaded.wasm: 200, 11,246,032 bytes
```

没有对生产运行写入型 `test:auth` / `test:community` / `test:peak`，因为当前测试脚本清理逻辑面向本地 SQLite，直接指向生产可能留下测试账号或测试数据。

## 4. 本轮代码改动

新增：

```text
docs/launch-readiness-detection-plan-20260702.md
docs/launch-readiness-execution-report-20260702.md
scripts/test-browser-e2e.js
scripts/test-production-readonly.js
```

修改：

```text
package.json
README.md
styles.css
community-post-card.css
public/styles.css
public/community-post-card.css
docs/launch-readiness-detection-plan-20260702.md
docs/launch-readiness-execution-report-20260702.md
```

修改目的：

- 补齐触控组件规范，保证核心可点击控件高度不低于 44px。
- 同步源文件到 `public/`。
- 增加真实浏览器 E2E 和生产只读预检命令。

## 5. 当前上线判断

当前可以推进：

```text
小规模演示：可以
50 人轻量试用：可以，建议现场预热资源并保守控流
正式完整生产承诺：暂不建议
```

上线当天必须执行：

1. 先跑 `pnpm test:prod:readonly` 做生产只读预检。
2. 在隔离测试环境跑 `pnpm test:browser`、`pnpm test:auth`、`pnpm test:community`、`pnpm test:peak`。
3. 如需对正式生产跑写入型测试，先准备可清理测试账号和测试数据的安全脚本。
4. 预热首页静态资源和 OSEA 模型资源。
5. 限制现场集中上传大图。
6. 确认 `/var/lib/birdora/` 每日备份已经启用。
7. 对外文案继续写“Top 5 辅助识别 / 万级标签候选”，不要写“精准识别 11000 种”。

## 6. 遗留风险

P1：

- 单用户真实浏览器 E2E 已自动化；真实浏览器 50 人并发未覆盖。
- 5 人同时识别和 ONNX/WASM 首载未覆盖。
- 生产写入型测试需要安全清理版本，当前没有直接跑。

P2：

- 首页大图和设备图仍为 PNG，资源较大。
- 社区页仍建议继续观察评论/提问按钮在真实手机上的点击路径。
- OSEA 缺失 36 个输出标签映射仍需长期处理。
- Docker/compose 当前更偏 API 容器形态，不等同完整 Nginx + 静态站托管方案。

## 7. 最终口径

建议对用户和现场人员使用这个口径：

```text
Birdora 当前版本已经通过本地隔离数据库的认证、社区、权限、持久化、移动端布局和 50 人轻量社区 API 峰值演练。可以支持 2026-07-03 小规模演示和保守的 50 人轻量网页试用。鸟类识别是浏览器本地 OSEA 模型 Top 5 辅助识别，文案分析是规则 MVP。正式生产前仍需补真实浏览器并发、识别首载并发、生产安全写入测试和数据备份验收。
```
