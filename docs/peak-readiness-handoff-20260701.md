# Birdora 50 人峰值准备交接文档

创建日期：2026-07-01

目标峰值日期：2026-07-03

## 1. 本次工作目标

两天后需要支持约 50 人通过网页集中浏览和轻量使用 Birdora。必须验证并补齐：

1. 鸟类识别：上传鸟照后可运行识别，明确当前完成度、模型来源、识别范围、耗时和风险。
2. 图文文案：用户可以发布图文文案，发布后其他账号可浏览、评价、评论或提问。
3. 内容权限：发布账号可以编辑自己的文案；非发布账号不能编辑他人文案。
4. 后端数据库：账号、图文内容、图片、评价、评论、提问必须有可靠持久化；回复、编辑记录、识别记录属于后续增强项。
5. 网页可用性：登录、浏览、识别、发布、互动在桌面和手机浏览器中可用。
6. 峰值准备：50 人访问下服务不崩溃，核心请求响应时间可接受，错误有清晰提示。

## 1.1 2026-07-01 八路审核后的真实状态

如本节和下文旧计划冲突，以本节为准。

已完成并复测：

- 账号注册、登录、登出。
- SQLite 持久化社区帖子、轻量文案分析、图片、评价、评论、提问。
- A 账号发布图文后，B 账号可浏览、评价、评论、提问。
- 作者可编辑自己的标题和正文，可删除自己的帖子。
- 非作者编辑、删除会被后端拒绝。
- 社区图片默认存储在数据库同级目录：`<database-dir>/uploads/community`。
- 社区列表 API 支持 `limit` / `offset` 分页，前端社区页支持加载更多。
- `pnpm test:auth`、`pnpm test:community`、`pnpm test:atlas`、`pnpm test:peak` 已通过。

仍未完成或只能降级说明：

- 文案分析已有规则 MVP；独立 AI 改写、审核模型尚未接入。
- 作者暂不能在编辑表单里替换图片或修改发布状态。
- `post_answers`、`post_edit_events`、`bird_recognition_jobs` 尚未建表。
- `test:peak` 是轻量社区 API 峰值，已覆盖 3 张 tiny PNG 带图发布和图片读取；不覆盖真实浏览器静态资源、大图流量、ONNX/WASM 首载和 5 人同时识别。
- OSEA 标签库 10,964 条，模型观测输出 11,000 维，不能宣称全量标签覆盖。

新增审核文档：

```text
docs/eight-agent-audit-report-20260701.md
```

## 2. 必读上下文

接手 agent 开始前必须先读：

```text
AGENTS.md
README.md
docs/backend-handoff.md
docs/bird-recognition-handoff.md
docs/mobile-web-adaptation-handoff.md
docs/production-launch-report-20260629.md
docs/stability-repair-master-plan-20260630.md
```

本地项目路径：

```text
C:\Users\Administrator\Documents\逸轩_开发\website\birdora-web
```

正式站点：

```text
https://birdora.birdai-glasses.com/
```

开发仓库：

```text
origin: https://github.com/yuki-liuk/birdora-web.git
```

生产交接中记录的临时部署仓库：

```text
deploy-temp: https://github.com/muchensu77-create/birdora-web-deploy.git
branch: deploy/birdora-web-20260629
```

## 3. 当前已知状态

从现有文档可知：

- Birdora 是“静态前端 + Express 认证和社区 API”的混合项目。
- 认证后端已有注册、登录、登出、当前用户、登录状态接口。
- 认证数据当前存储在 SQLite。
- 鸟类识别已接入 OSEA ONNX 模型，可从 10,964 个鸟类标签中返回 Top 5 候选。
- 本地图鉴富资料仍然只补充了少量常见鸟，不能宣传“精准识别 1000 种”。
- 当前社区/图文发布能力需要重点复核是否只是前端本地存储，还是已经后端持久化。
- 若只改前端源文件，修改后必须运行 `pnpm sync:public`。

## 4. 两天执行排期

### 第 1 天上午：最新版和状态确认

目的：确认本地代码是否是 GitHub 最新版本，并判断现有完成度。

任务：

1. 运行 `git status --short --branch`，记录当前分支和本地改动。
2. 运行 `git remote -v`，确认 `origin` 和 `deploy-temp`。
3. 拉取远端信息，比较本地分支与远端最新 commit。
4. 确认 latest release/tag、默认分支和最新提交。
5. 若需要下载全新副本，放到独立目录，不覆盖现有工作区。
6. 阅读 `README.md`、`package.json`、`server.js`、`script.js`、`app/db/database.js`。
7. 输出“当前完成度表”：
   - 认证：完成 / 可用但需修 / 缺失
   - 鸟类识别：完成 / 可用但需修 / 缺失
   - 图文发布：完成 / 可用但需修 / 缺失
   - 评论评价问答：完成 / 可用但需修 / 缺失
   - 后端持久化：完成 / 可用但需修 / 缺失
   - 编辑权限：完成 / 可用但需修 / 缺失

验收输出：

```text
docs/peak-readiness-report-YYYYMMDD.md
```

### 第 1 天下午：本地启动和基础冒烟

目的：把网页和后端在本地跑起来。

任务：

1. 确认 Node.js 版本满足 `>=24.14.0`。
2. 安装依赖或确认依赖完整。
3. 启动后端 API，默认端口 `4000`。
4. 启动前端静态服务，默认端口 `4174`。
5. 打开 `http://127.0.0.1:4174/`。
6. 验证：
   - 首页可打开。
   - 登录页可打开。
   - 注册、登录、登出可用。
   - 登录后刷新仍保持登录态。
   - 鸟类识别区域可上传图片。
   - 社区页可浏览。
   - 图文发布入口可找到。

基础命令：

```bash
pnpm install --frozen-lockfile
pnpm start
pnpm start:web
pnpm test:auth
pnpm test:atlas
```

### 第 2 天上午：核心业务闭环

目的：验证用户提出的 3 个核心组件。

鸟类识别测试：

1. 检查模型文件是否存在：
   - `public/assets/osea/bird_model.onnx`
   - `public/assets/osea/bird_info.json`
2. 上传样例鸟图。
3. 记录首次加载耗时、二次识别耗时、Top 5 返回情况。
4. 测试异常输入：
   - 空文件
   - 非图片文件
   - 超大图片
   - 模糊图片
5. 结论必须写清：
   - 识别是否真实运行模型。
   - 是否只在浏览器本地推理。
   - 是否依赖外部 API。
   - 可宣传的范围和不能宣传的范围。

图文文案测试：

1. A 账号登录。
2. A 账号创建图文文案。
3. A 账号发布成功后，内容进入公共列表。
4. B 账号登录。
5. B 账号可以浏览 A 发布的内容。
6. B 账号可以评价、评论或提问。
7. A 账号能看到 B 的互动。
8. A 账号可以编辑自己的标题和正文；图片替换和发布状态修改是后续增强。
9. B 账号不能编辑 A 的内容。
10. 刷新页面、重启服务后数据仍存在。

数据库测试：

1. 检查 SQLite 表结构。
2. 确认内容数据不是只放在 `localStorage`。
3. 若缺表，优先补以下结构：
   - `users`
   - `posts`
   - `post_images`
   - `post_reactions`
   - `post_comments`
   - `post_questions`
   - `post_answers`（后续增强）
   - `post_edit_events`（后续增强）
   - `bird_recognition_jobs`（后续增强）
4. 所有写接口必须校验登录态。
5. 所有编辑接口必须校验作者或管理员权限。

### 第 2 天下午：50 人峰值演练

目的：模拟 50 人集中使用，确认不崩溃。

建议场景：

1. 50 个虚拟用户打开首页。
2. 50 个虚拟用户访问社区列表。
3. 20 个虚拟用户查看图文详情。
4. 10 个虚拟用户同时发布图文。
5. 20 个虚拟用户同时评论、评价或提问。
6. 5 个虚拟用户同时上传鸟图识别。
7. 发布者编辑文案后，其他账号刷新能看到更新。

建议指标：

```text
首页 / 列表页：P95 < 2s
详情页：P95 < 2s
登录 / 注册：P95 < 3s
图文发布：P95 < 5s
评论 / 评价 / 提问：P95 < 3s
鸟类识别：单独记录，首次加载模型可慢，二次识别应明显更快
错误率：核心接口 < 1%
服务状态：不能崩溃，不能卡死
权限：不能串号，不能编辑别人内容
```

## 5. 数据库设计要求

如果现有后端没有图文社区持久化，需要补齐最小可用数据库结构。

建议字段：

`posts`

```text
id
author_user_id
title
body
analysis_summary
analysis_score
analysis_tags
analysis_suggestions
analysis_updated_at
status
created_at
updated_at
deleted_at
```

`post_images`

```text
id
post_id
storage_path
original_name
mime_type
size_bytes
width
height
created_at
```

`post_reactions`

```text
id
post_id
user_id
reaction_type
score
created_at
updated_at
```

`post_comments`

```text
id
post_id
user_id
body
created_at
updated_at
deleted_at
```

`post_questions`

```text
id
post_id
user_id
question
created_at
updated_at
status
```

`post_answers`

```text
id
question_id
user_id
answer
created_at
updated_at
```

`post_edit_events`

```text
id
post_id
editor_user_id
event_type
before_json
after_json
created_at
```

`bird_recognition_jobs`

```text
id
user_id
image_name
top_result_json
top5_json
duration_ms
created_at
```

## 6. API 最小清单

若缺失社区后端，建议补齐这些接口：

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

权限：

- `GET /api/community/posts` 可按产品策略决定是否允许未登录访问。
- 所有写操作必须登录。
- `PATCH /api/community/posts/:id` 和 `DELETE /api/community/posts/:id` 只能作者本人操作。
- 评论、评价、提问不能冒充其他账号。

## 7. 浏览器验收清单

桌面至少验收：

```text
1366 x 768
1440 x 900
1920 x 1080
```

手机至少验收：

```text
360 x 800
375 x 667
390 x 844
414 x 896
430 x 932
768 x 1024
```

每个尺寸检查：

- 无横向滚动。
- 顶部栏不遮挡。
- 登录表单完整可用。
- 鸟图上传入口可点。
- 识别结果 Top 5 可读。
- 图文发布表单不溢出。
- 评论、评价、提问输入可用。
- 编辑入口只对作者显示。
- 错误提示可读，不白屏。

## 8. 修复优先级

P0 必须完成：

1. 最新版代码确认。
2. 本地可启动。
3. 登录注册可用。
4. 鸟类识别可用或明确阻塞原因。
5. 图文发布持久化。
6. 多账号浏览与互动。
7. 作者编辑权限。
8. 50 人基础峰值不崩溃。

P1 尽量完成：

1. 图文图片上传持久化。
2. 编辑历史记录。
3. 评论、评价、提问的基础管理。
4. 移动端主流程无明显布局问题。
5. 错误提示和 loading 状态完整。

P2 后续优化：

1. 更完整的文案 AI 分析。
2. 识别结果后端记录和统计。
3. 图片对象存储。
4. PostgreSQL / MySQL 迁移。
5. 自动化监控和备份。

## 9. 开工顺序

当前线程完成本文档后，按以下顺序开工：

1. 确认 git 状态和最新版。
2. 拉取或下载 GitHub 最新版本到安全位置。
3. 对比本地和远端差异，不覆盖未确认改动。
4. 安装依赖并启动本地网页。
5. 运行已有测试。
6. 审计鸟类识别、社区发布、数据库和权限代码。
7. 记录完成度。
8. 若图文社区后端缺失，优先补最小闭环。
9. 做多账号浏览、互动、编辑验证。
10. 做 50 人峰值测试。
11. 写最终测试和风险报告。

## 10. 最终交付格式

最终必须给用户说明：

1. 使用的 GitHub 仓库、分支、commit。
2. 是否已经是最新版本。
3. 本地启动结果。
4. 鸟类识别真实完成度。
5. 图文文案和社区互动完成度。
6. 数据库结构和持久化情况。
7. 50 人峰值测试结果。
8. 还不能上线的风险。
9. 两天后使用判断：可上线 / 可演示 / 不建议上线。
