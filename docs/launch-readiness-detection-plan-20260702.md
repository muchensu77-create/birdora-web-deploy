# Birdora 上线准备检测计划

日期：2026-07-02

目标峰值日期：2026-07-03

## 1. 检测目标

本次检测目标是判断 Birdora 当前版本是否能支撑 2026-07-03 约 50 人网页集中轻量使用，并明确：

1. 哪些功能可以上线或演示。
2. 哪些能力只能降级说明。
3. 哪些问题上线前必须复测。
4. 哪些问题会阻断正式生产承诺。

当前文档和代码共同指向的真实结论是：可以按小规模演示和轻量试用推进，但不能夸大为完整生产峰值已覆盖。

## 2. 必读依据

检测前必须先阅读：

```text
AGENTS.md
README.md
docs/eight-agent-audit-plan-20260701.md
docs/eight-agent-audit-report-20260701.md
docs/peak-readiness-handoff-20260701.md
docs/peak-readiness-report-20260701.md
docs/backend-handoff.md
docs/bird-recognition-handoff.md
docs/mobile-web-adaptation-handoff.md
docs/production-launch-report-20260629.md
docs/stability-repair-master-plan-20260630.md
docs/deep-bug-audit-20260629.md
docs/deployment.md
docs/auth-api.md
```

## 3. 当前项目边界

项目路径：

```text
C:\Users\Administrator\Documents\逸轩_开发\website\birdora-web
```

正式站点：

```text
https://birdora.birdai-glasses.com/
```

当前后端形态：

```text
Express API + SQLite + JWT HttpOnly cookie
```

当前前端形态：

```text
根目录 HTML/CSS/JS 是源文件，public/ 是发布目录
```

重要规则：

1. 不要只改 `public/`。
2. 修改根目录前端源文件后必须运行 `pnpm sync:public`。
3. 静态服务只能托管 `public/`，不能暴露项目根目录。
4. 不要停止或修改同服务器上的 `birdora-api`、`birdora-recognition`、`birdora-studio`、`zhubao-api`。
5. 生产数据目录必须是可备份目录，例如 `/var/lib/birdora/`。

## 4. 检测代理分工

### 代理 1：功能闭环检测

检测范围：

- 注册、登录、退出。
- 首页浏览。
- 鸟图上传识别。
- 图文发布。
- 社区浏览。
- 评价、评论、提问。
- 作者编辑、删除。
- 非作者编辑、删除拦截。

验证方法：

1. A 账号注册登录。
2. A 发布带图文案。
3. B 账号注册登录。
4. B 浏览 A 的帖子。
5. B 评价、评论、提问。
6. A 编辑自己的标题和正文。
7. B 修改或删除 A 帖子应返回 403。
8. A 删除帖子后图片地址应返回 404。

通过标准：

- 主流程无白屏、无接口 500。
- 多账号权限不串号。
- 刷新页面后数据仍存在。

### 代理 2：数据库与持久化检测

检测范围：

- `users`
- `revoked_tokens`
- `community_posts`
- `community_post_images`
- `community_post_reactions`
- `community_post_comments`
- `community_post_questions`

验证方法：

1. 检查 SQLite 自动建表。
2. 检查 WAL、foreign key、busy timeout。
3. 发帖、评论、提问、评价后重启服务再读取。
4. 删除用户或帖子时确认级联数据一致。
5. 删除帖子时确认图片文件同步清理。

通过标准：

- 数据不是只存在 localStorage。
- 图片文件和数据库记录一致。
- 50 人轻量写入下无锁死。

### 代理 3：鸟类识别检测

检测范围：

- `assets/osea/bird_model.onnx`
- `assets/osea/bird_info.json`
- `assets/vendor/ort.min.js`
- `assets/vendor/ort-wasm-simd-threaded.wasm`
- 首页识别上传、Top 5、低置信度、异常输入。

验证方法：

1. 检查模型、标签、WASM 文件存在。
2. 运行 `pnpm test:atlas`。
3. 上传样例鸟图，记录首次加载和二次识别耗时。
4. 测试空文件、非图片、超大图片、模糊图片。
5. 检查 UI 文案是否说明 10,964 标签和 11,000 输出差异。

通过标准：

- 真实加载 OSEA 模型并返回 Top 5。
- 缺失标签不会被当作可信识别成功。
- 不宣传“精准识别 1000+ / 11000 种”。

### 代理 4：性能与 50 人峰值检测

检测范围：

- 认证接口。
- 社区列表。
- 图文发布。
- 图片读取。
- 评价、评论、提问。
- 静态资源。
- ONNX/WASM 首载。

验证方法：

1. 运行 `pnpm test:peak`。
2. 使用隔离数据库，避免污染演示数据。
3. 增补浏览器侧检测：50 人打开首页和社区页。
4. 增补识别侧检测：5 人同时触发模型加载和识别。
5. 增补大图检测：1MB 边界图、多张图片读取。

通过标准：

```text
首页 / 列表页 P95 < 2s
登录 / 注册 P95 < 3s
图文发布 P95 < 5s
评论 / 评价 / 提问 P95 < 3s
核心接口错误率 < 1%
服务不崩溃，不卡死
```

注意：当前 `pnpm test:peak` 只是轻量社区 API 峰值，不覆盖真实浏览器静态资源、ONNX/WASM 首载和 5 人同时识别。

### 代理 5：安全与权限检测

检测范围：

- JWT HttpOnly cookie。
- CORS。
- 认证和社区写接口限流。
- 作者权限。
- 上传图片真实文件头。
- XSS 转义。
- 路径穿越。
- 私有文件暴露。
- 生产密钥约束。

验证方法：

1. 注册和登录响应 JSON 不应返回 JWT。
2. 非白名单 Origin 应返回 403。
3. 未登录写接口应返回 401。
4. 非作者 `PATCH` / `DELETE` 应返回 403。
5. 伪装图片内容应返回 400。
6. 评论、提问、标题和正文渲染后不能执行脚本。
7. `/server.js`、`/app/data/birdora.sqlite`、`/.env` 应不可访问。

通过标准：

- 权限由后端强制。
- 上传目录不能路径穿越。
- 生产弱密钥不能启动。
- Nginx 只暴露 `public/`。

### 代理 6：移动端与浏览器体验检测

检测范围：

- `index.html`
- `login.html`
- `community.html`
- `privacy.html`
- `terms.html`
- `styles.css`
- `community-post-card.css`

验收尺寸：

```text
360 x 800
375 x 667
390 x 844
414 x 896
430 x 932
768 x 1024
667 x 375
1366 x 768
1440 x 900
1920 x 1080
```

验证方法：

1. 每个尺寸打开首页、登录页、社区页、协议页。
2. 检查无横向滚动。
3. 检查顶部栏不遮挡。
4. 检查登录表单完整可用。
5. 检查上传入口、预览、Top 5、发布按钮可见。
6. 检查社区发帖、评论、提问面板可输入可提交。
7. 检查按钮触控高度不低于 44px。

通过标准：

- 不靠页面级 `overflow-x: hidden` 掩盖问题。
- 文本不互相遮挡。
- 关键按钮、输入框、错误提示可读可点。

### 代理 7：开发规范与组件规范检测

检测范围：

- `script.js` 单体规模。
- 社区 API / card / route / controller / service 分层。
- 重复工具函数。
- CSS 后写覆盖层。
- 源文件与 `public/` 同步。

验证方法：

1. 检查是否有重复 `escapeHtml` 等工具函数。
2. 检查社区组件是否通过 `community-api.js` 和 `community-post-card.js` 复用。
3. 检查后端路由、控制器、服务是否分层清楚。
4. 检查 CSS 是否存在互相覆盖的响应式规则。
5. 运行 `pnpm sync:public` 后确认源文件和 `public/` 关键文件一致。

通过标准：

- 新功能不继续堆进无法维护的大单体。
- 社区功能保持 API、UI 卡片、路由、控制器、服务分层。
- CSS 修改有明确位置，不随机覆盖。
- `public/` 不作为源文件手工修改。

### 代理 8：部署与上线检测

检测范围：

- `deploy/nginx/birdora-https.conf`
- `deploy/scripts/preflight.sh`
- `deploy/scripts/install-http.sh`
- `deploy/scripts/enable-https.sh`
- `Dockerfile`
- `compose.yaml`
- `.env`
- PM2、Nginx、HTTPS、备份、回滚。

验证方法：

1. 检查 Node.js 版本 `>=24.14.0`。
2. 检查生产 `.env` 必须设置强随机 `JWT_SECRET`。
3. 检查 `CORS_ORIGIN=https://birdora.birdai-glasses.com`。
4. 检查 `DATABASE_FILE=/var/lib/birdora/birdora.sqlite`。
5. 检查 Nginx root 指向 `/var/www/birdora-web/public`。
6. 检查 `/api/` 反代到 `127.0.0.1:3003`。
7. 检查 `/var/lib/birdora/` 备份策略。
8. 上线后复测 Birdora 和同机旧服务。

通过标准：

- `https://birdora.birdai-glasses.com/` 返回 200。
- `/api/health` 返回 200。
- 私有文件返回 404。
- `jewelry-api.birdai-glasses.com` 仍返回 200。
- PM2 中旧服务不被停止或覆盖。

## 5. API 检测清单

认证接口：

```text
GET    /api/health
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/auth/status
```

社区接口：

```text
GET    /api/community/posts
POST   /api/community/posts
GET    /api/community/posts/:id/image
PATCH  /api/community/posts/:id
DELETE /api/community/posts/:id
POST   /api/community/posts/:id/reactions
POST   /api/community/posts/:id/comments
POST   /api/community/posts/:id/questions
```

每个写接口必须检测：

1. 未登录返回 401。
2. 参数缺失返回 400。
3. 超长内容返回 400。
4. 登录用户成功写入。
5. 非作者管理他人内容返回 403。
6. 返回体不泄露密码、JWT、服务器路径。

## 6. 本地检测命令

先确认工作区：

```bash
git status --short --branch
git remote -v
node -v
pnpm -v
```

静态和语法检查：

```bash
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

功能测试：

```bash
pnpm test:auth
pnpm test:browser
pnpm test:community
pnpm test:atlas
pnpm test:peak
pnpm test:prod:readonly
```

说明：

- `pnpm test:browser` 是写入型真实浏览器 E2E，默认只允许本地地址。
- `pnpm test:prod:readonly` 是生产只读预检，不创建账号、不发帖。

浏览器验收：

```text
http://127.0.0.1:4174/
http://127.0.0.1:4174/login.html
http://127.0.0.1:4174/community.html
```

## 7. 上线准入

可以上线或演示的最低条件：

1. 本地和生产均通过 `pnpm test:auth`。
2. 本地和生产均通过 `pnpm test:community`。
3. 至少一次隔离数据库 50 人轻量峰值通过。
4. 浏览器完成注册、登录、发布、互动、编辑、删除完整闭环。
5. 手机核心尺寸无横向溢出和遮挡。
6. OSEA 模型资源可加载，Top 5 可展示。
7. 生产健康检查通过。
8. 私有文件不可访问。
9. `/var/lib/birdora/` 已有备份方案。
10. 文案明确标注“文案分析是规则 MVP，不是独立 AI 改写/审核模型”。

不建议正式承诺生产的条件：

1. 未完成真实浏览器 E2E。
2. 未覆盖 ONNX/WASM 首载峰值。
3. 未覆盖 5 人同时识别。
4. 未覆盖真实大图上传和大量图片浏览。
5. 未处理或解释 10,964 标签与 11,000 输出差异。
6. 未在正式服务器复跑测试。
7. 生产数据目录没有备份。

## 8. 最终报告格式

最终检测报告必须包含：

```text
1. 仓库、分支、commit
2. 本地工作区是否有未提交改动
3. 本地启动结果
4. 生产站点健康结果
5. 认证完成度
6. 社区图文完成度
7. 鸟类识别真实完成度
8. 数据库和图片持久化情况
9. 50 人峰值结果
10. 移动端验收结果
11. API 与权限验收结果
12. 安全与私有文件验收结果
13. 代码规范和组件规范发现
14. 还不能上线的风险
15. 最终判断：可上线 / 可演示 / 不建议上线
```

最终判断口径：

- `可上线`：生产环境、功能闭环、峰值、移动端、安全、备份全部通过。
- `可演示`：核心闭环可用，但仍有明确降级说明和规避策略。
- `不建议上线`：认证、数据持久化、权限、部署隔离、生产健康或主流程存在阻断问题。
