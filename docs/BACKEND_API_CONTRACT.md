# Birdora Web 后端接口与维护契约

> 适用分支：`feature/v1.7.0-front-plus`
> 更新日期：2026-07-12
> 运行形态：静态网站 + Express API + 单进程 SQLite；不是微信小程序

## 1. 接口约定

- 浏览器认证使用 HttpOnly JWT Cookie；所有非安全方法仍须通过 Origin/Referer allowlist。
- `/api/v1/*` 新接口统一返回 `{ data, pageInfo?, requestId }`；旧 `/api/community/posts/*` 为兼容契约。
- 游标是服务端 HMAC 签名的不透明字符串，调用方不得解析或拼接。
- UUID 参数必须为 v4；JSON 写接口拒绝数组、标量和未知字段。
- 正式发布、旧帖子编辑、旧 reactions 和账号注销仍受服务端 feature flag 保护。

## 2. 网页当前使用的后端接口

### 认证与资料

- `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`
- `GET /api/auth/status`、`GET /api/auth/me`
- `PATCH /api/auth/profile`：稀疏更新 bio/gender/age/avatar/publicProfile/emailNotifications
- `DELETE /api/auth/account`：高风险兼容入口，生产默认关闭

### 识鸟与观测

- `POST /api/recognition`
- `POST /api/observations`、`GET /api/observations/me`
- `GET /api/observations/:id`、`GET /api/observations/:id/image`
- `DELETE /api/observations/:id`

### 社区兼容接口

- `GET/POST /api/community/posts`
- `GET/PATCH/DELETE /api/community/posts/:id`
- `GET /api/community/posts/:id/image|video`
- `GET/POST /api/community/posts/:id/comments`
- `DELETE /api/community/posts/:postId/comments/:commentId`
- `GET/POST /api/community/posts/:id/questions`
- `POST /api/community/posts/:id/reactions`：仅旧兼容，正式 UI 使用 canonical like

帖子详情、评论/提问列表和媒体端点执行同一套可见性规则：owner 可见自己的非删除内容；其他人只能看 approved + published 的 public，或在已关注作者时看 followers；private 和未授权 followers 统一返回 404。非公开媒体返回 `Cache-Control: private, no-store`。

### 社交与 Feed

- `GET /api/v1/feed?type=recommended|following&limit=&cursor=`
- `GET /api/v1/users/:userId`
- `PUT/DELETE /api/v1/users/:userId/follow`
- `GET /api/v1/users/:userId/followers|following`
- `GET /api/v1/me/stats`、`GET /api/v1/me/posts`
- `PUT/DELETE /api/v1/posts/:postId/like`：desired-state 幂等接口

### 云草稿与原子发布

- `GET/POST /api/v1/drafts`
- `GET/PATCH/DELETE /api/v1/drafts/:draftId`
- `POST /api/v1/drafts/:draftId/publish`

PATCH 必须提交当前 `version`，过期版本返回 `DRAFT_VERSION_CONFLICT`。发布必须带 8-128 字符的 `Idempotency-Key`；同键同请求返回同一帖子，同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`。帖子写入、媒体绑定、草稿消费和幂等记录在同一 SQLite 事务内完成。

### 通知

- `GET /api/v1/notifications`、`GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/:notificationId/read`
- `POST /api/v1/notifications/read-all`
- `GET/PATCH /api/v1/notification-preferences`

当前通知源为 follow、like、comment；同一业务动作使用唯一 dedupe key。通知写入与业务写入同事务，适用于当前单进程 SQLite。Outbox worker/SSE 尚未实现。

### 能力发现

- `GET /api/v1/capabilities`

前端必须 fail-closed：无法读取能力时禁用写操作，不得用本地模拟数据冒充接口成功。

## 3. 数据库迁移链

| 版本 | 目的 | 数据策略 |
|---|---|---|
| V001 | 采用已发布 schema / 建立基线 | 不替换已发布业务表 |
| V002 | legacy JSON 一次性导入与旧表退役标记 | 不 DROP 业务表 |
| V003 | account status、Outbox、删除 job、draft、media foundation | 只增列/表 |
| V004 | `user_follows` | 只增表 |
| V005 | 帖子位置、可见性、状态、审核、版本 | 旧帖原地回填 published/approved/public |
| V006 | canonical likes | 由旧 helpful reaction 去重回填 |
| V007 | 发布幂等记录 | 只增表/索引 |
| V008 | revisions/reports/moderation/roles/audit foundation | 只增表 |
| V009 | notifications/preferences/event stream | 从 users 邮件偏好回填 |

迁移文件一经在任何环境应用不得修改；新增变更只能追加 V010+。普通生产 server 不运行 migration，必须先只读 preflight、停写、快照/媒体备份，再显式执行 migration。

## 4. 本地验收命令

```bash
pnpm sync:public
node scripts/test-frontend-contracts.js
node scripts/test-database-migrations.js
node scripts/test-api-integration.js
node scripts/test-core.js
git diff --check
```

所有测试使用临时数据库和临时媒体目录，不得把测试指向生产 URL 或生产 SQLite。

## 5. 尚未闭环的上线项

- V008 举报/审核/管理员 API 与运营界面。
- Outbox consumer、重试/dead-letter、通知轮询/SSE 和容量告警。
- `media_assets` 全量接管头像、帖子、观测与注销清理。
- 设备配对/同步、图鉴 CMS、密码找回和邮件投递不在当前后端闭环范围。
- 可访问预发布域名的真实浏览器主流程、真实 Nginx 代理上传边界，以及目标 Ubuntu legacy adoption/PM2/锁/journal/恢复证据。

在上述生产证据齐全前，保持发布/编辑/注销高风险开关关闭，不连接或修改线上数据库。
