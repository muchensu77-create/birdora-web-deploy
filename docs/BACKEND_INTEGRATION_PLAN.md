# Birdora 网站后端完整对接方案

> 适用项目：`birdora-web-1.7.0`  
> 文档目标：逐项说明当前网站所有需要后端支持的功能、现状、数据结构、接口约定、前端改造点、测试方式和上线要求。  
> 重要边界：积分功能已经从产品中删除，后端数据库、接口、统计和通知中都不应重新引入积分字段或积分事件。

## 1. 当前项目结论

项目不是“完全没有后端”。仓库中已经存在 Express + SQLite 后端，并实现了以下能力：

- 注册、登录、退出、获取当前用户、编辑个人资料、注销账号。
- JWT HttpOnly Cookie 会话、令牌撤销、请求限流、CORS 和 Origin 校验。
- 鸟照服务端识别接口。
- 保存、查询和删除用户自己的识别观测记录。
- 社区帖子发布、图片或视频保存、帖子编辑和删除。
- 社区评论、提问、两种 reaction 互动。
- 请求 ID、统一错误响应和基础敏感日志脱敏。

仍属于前端模拟、静态数据或实现不完整的部分：

- “关注”关系和关注动态流。
- “推荐”流的真正推荐/随机逻辑。
- 消息中心、未读数和消息已读状态。
- 发布草稿的云端保存。
- 设备绑定、蓝牙状态、照片同步、固件和存储信息；当前只是 `localStorage` 模拟。
- 图鉴搜索服务；当前主要读取前端静态 JSON 和模型标签。
- 首页推荐观鸟地点的后台配置或位置推荐。
- 社区地点的独立字段；当前发布时把地点拼进正文。
- 对外个人主页、关注/粉丝列表、个人内容统计。
- 举报、审核、内容安全、后台管理和审计。
- 对象存储、缩略图、视频转码；当前媒体写到本机磁盘。

## 2. 推荐总体架构

### 2.1 第一阶段：保持单体，先把功能接完整

当前规模不需要立刻拆微服务。建议保留一个 Node.js API：

```text
浏览器静态页面
  -> HTTPS /api/*
Express API
  -> PostgreSQL（开发期可继续 SQLite）
  -> 对象存储（鸟照、头像、帖子图片、视频）
  -> 识别模型服务或本机 ONNX Runtime
  -> 异步任务队列（缩略图、视频转码、通知、设备同步）
```

生产环境建议：

- 数据库：PostgreSQL 16+；SQLite 只适合单机原型和测试。
- 媒体：S3 兼容对象存储，不把 Base64 长期放数据库，也不依赖单台 API 机器磁盘。
- 缓存/队列：Redis，可用于限流、推荐缓存、未读数和异步任务。
- 反向代理：Nginx、Caddy 或云平台网关，统一 HTTPS、压缩和静态缓存。
- API 版本：新接口统一放在 `/api/v1`。现有 `/api/*` 暂时保留，前端迁移完成后再废弃。

### 2.2 统一接口规范

成功响应：

```json
{
  "data": {},
  "requestId": "req_xxx"
}
```

列表响应：

```json
{
  "data": [],
  "pageInfo": {
    "cursor": "opaque_cursor",
    "hasMore": true
  },
  "requestId": "req_xxx"
}
```

失败响应：

```json
{
  "code": "VALIDATION_ERROR",
  "message": "地点长度不能超过 160 个字符",
  "fieldErrors": {
    "location": "内容过长"
  },
  "requestId": "req_xxx"
}
```

通用要求：

- 时间一律存 UTC ISO 8601，前端按用户时区显示。
- ID 使用 UUID 或 ULID，前端不得自己生成最终业务 ID。
- 金额、积分相关字段一律不存在。
- 翻页优先使用游标，避免社区新增内容导致 offset 重复或跳项。
- 所有写接口支持 `Idempotency-Key`，避免网络重试产生重复帖子、评论或观测记录。
- 所有可变资源返回 `createdAt`、`updatedAt`；需要并发编辑时增加 `version`。

## 3. 身份认证与账号

### 3.1 已有实现

现有接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/auth/register` | 注册并写入登录 Cookie |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 撤销当前 JWT 并清 Cookie |
| GET | `/api/auth/status` | 导航栏判断登录状态 |
| GET | `/api/auth/me` | 获取当前用户 |
| PATCH | `/api/auth/profile` | 更新资料和偏好 |
| DELETE | `/api/auth/account` | 密码确认后注销账号 |

前端 `register.html`、`login.html`、`profile.html` 和导航栏已经调用这些接口。

### 3.2 还需补齐

- 邮箱验证：`POST /api/v1/auth/email-verifications`、`POST /api/v1/auth/email-verifications/confirm`。
- 忘记密码：申请重置、一次性令牌校验、设置新密码。
- 修改密码：要求当前密码，成功后撤销其他会话。
- 会话列表：查看登录设备并允许远程退出。
- 登录失败保护：按账号和 IP 双维度限流，必要时短时锁定。
- 注册协议版本：保存用户同意的服务条款和隐私政策版本及时间。

建议增加表：

```sql
email_verification_tokens(id, user_id, token_hash, expires_at, used_at, created_at)
password_reset_tokens(id, user_id, token_hash, expires_at, used_at, created_at)
auth_sessions(id, user_id, refresh_token_hash, user_agent, ip_hash, expires_at, revoked_at, created_at)
user_consents(id, user_id, document_type, document_version, accepted_at)
```

不要把 JWT、验证码或重置令牌明文写入数据库和日志，只保存哈希。

## 4. 用户资料、个人页与关注关系

### 4.1 已有资料字段

`users` 已有：昵称、简介、性别、年龄、头像、邮件通知开关、个人资料公开开关。

改进建议：

- 头像改用对象存储 URL，不再把 Base64 Data URL 直接写入 `users.avatar_url`。
- 年龄最好保存出生年份或年龄段，避免每年失真；公开页面默认不展示精确年龄。
- 性别和年龄均应允许不填写。
- 个人资料公开关闭后，公开接口只返回最小信息。

### 4.2 关注功能

新增表：

```sql
user_follows(
  follower_id,
  followed_id,
  created_at,
  PRIMARY KEY(follower_id, followed_id),
  CHECK(follower_id <> followed_id)
)
```

接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/users/:id` | 公开个人资料和统计 |
| PUT | `/api/v1/users/:id/follow` | 关注，幂等 |
| DELETE | `/api/v1/users/:id/follow` | 取消关注，幂等 |
| GET | `/api/v1/users/:id/followers` | 粉丝列表 |
| GET | `/api/v1/users/:id/following` | 关注列表 |
| GET | `/api/v1/me/posts` | 当前用户帖子 |
| GET | `/api/v1/me/stats` | 帖子、观测、关注和粉丝统计 |

前端对接：

- 社区帖子作者区增加关注/取消关注按钮。
- 社区“关注”页不再复用推荐假数据，改调 `GET /api/v1/feed?type=following`。
- 个人页统计从 `/me/stats` 获取，不从当前页面数组长度推算。

## 5. 首页内容与推荐观鸟地点

首页日期应继续由浏览器实时生成；地点内容可以由后端管理。

两种实现：

1. 简单版：后台维护每日推荐，接口 `GET /api/v1/home/recommendation?date=2026-07-10`。
2. 个性化版：前端经用户授权只上传粗粒度城市，后端按城市、季节、天气和热门观测返回地点。

建议数据表：

```sql
birding_places(id, name, city, district, latitude_rounded, longitude_rounded,
  summary, cover_media_id, best_seasons_json, active, created_at, updated_at)
daily_place_recommendations(id, place_id, local_date, city, priority, reason, created_at)
```

响应示例：

```json
{
  "data": {
    "date": "2026-07-10",
    "place": { "id": "place_1", "name": "西湖公园", "city": "杭州" },
    "reason": "清晨水鸟活动较集中"
  }
}
```

隐私要求：未明确授权时不要请求精确定位；公开帖子默认只展示公园/区域，不展示鸟巢或珍稀鸟种的精确坐标。

## 6. 鸟照上传与识别

### 6.1 当前流程

- 前端可加载 OSEA ONNX 模型在浏览器识别。
- 也可调用 `POST /api/recognition/classify` 服务端识别。
- 当前服务端只接收小于 1MB 的 JPEG Base64。
- 前端展示 Top 5，再由用户确认并保存观测记录。

### 6.2 推荐生产流程

```text
选择图片
  -> 前端校验类型/尺寸并生成预览
  -> multipart/form-data 上传原图或压缩图
  -> 后端去除 EXIF/GPS、病毒扫描、生成哈希
  -> 识别服务返回任务 ID
  -> 小图同步返回；大图异步轮询或 SSE 推送结果
  -> 用户确认候选
  -> 创建 observation
```

推荐接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v1/recognitions` | `multipart/form-data` 创建识别任务 |
| GET | `/api/v1/recognitions/:id` | 查询任务状态和 Top 5 |
| POST | `/api/v1/recognitions/:id/confirm` | 用户确认最终鸟种并生成观测 |

识别记录字段：

```sql
recognition_jobs(
  id, user_id, media_id, model_name, model_version, status,
  candidates_json, error_code, started_at, completed_at, created_at
)
```

关键要求：

- 保存模型版本和标签库版本，便于结果复现。
- 不把模型置信度描述成百分百正确；前端保留用户确认步骤。
- 文件按真实文件签名校验，不能只相信扩展名和 MIME。
- 解码时限制总像素，防止解压炸弹。
- 图片进入公开社区前再次执行 EXIF 清除。
- 珍稀鸟类位置按规则模糊化或延迟公开。

## 7. 观测记录

### 7.1 已有能力

`observations` 已保存用户、图片、确认鸟种、学名、置信度、Top 5、地点文本、备注、来源和观测时间；现有接口支持创建、个人列表、详情、图片和删除。

### 7.2 建议补充

- 编辑地点、备注、观测时间和最终鸟种。
- 按日期、鸟种、地点筛选。
- 游标分页和总数统计。
- 可见性：私密、仅关注者、公开。
- 与帖子解除/重新建立关联。
- 导出用户数据，例如 JSON/CSV。

接口：

```text
GET    /api/v1/observations?cursor=&speciesId=&from=&to=&visibility=
POST   /api/v1/observations
GET    /api/v1/observations/:id
PATCH  /api/v1/observations/:id
DELETE /api/v1/observations/:id
POST   /api/v1/observations/export
```

建议把 `selected_species_name` 文本进一步关联 `species_id`，同时保留识别时名称快照，避免图鉴改名后历史记录丢失语义。

## 8. 鸟类图鉴与搜索

当前图鉴读取前端 `assets/atlas/*.json`、OSEA 标签和部分 Wikimedia 链接，适合作为离线兜底，但不适合长期多人维护。

建议表：

```sql
species(id, scientific_name, chinese_name, english_name, family_name,
  description, features, habitat, habits, conservation_status, updated_at)
species_aliases(id, species_id, locale, alias, normalized_alias)
species_media(id, species_id, media_id, source_url, license, attribution, sort_order)
species_search_documents(species_id, search_text, search_vector)
```

接口：

```text
GET /api/v1/species/search?q=翠鸟&limit=24&cursor=
GET /api/v1/species/:id
GET /api/v1/species/:id/similar
GET /api/v1/species/popular?region=hangzhou&season=summer
```

搜索需要覆盖中文名、英文名、拉丁名、别名和拼音；返回高亮字段时必须转义，不能把后端 HTML 直接插入页面。图片必须保存来源、许可证和署名信息。

迁移策略：

1. 先把现有 JSON 导入数据库并保留 JSON 兜底。
2. 前端搜索先请求后端，超时或离线时回退静态索引。
3. 用版本号和 ETag 缓存图鉴数据。

## 9. 社区推荐、关注与帖子

### 9.1 已有帖子能力

现有 `community_posts`、图片、视频、评论、问题和 reactions 已落库。帖子可关联一条本人观测记录。

当前不足：

- UI 的“点赞”与后端 `helpful/curious` 语义不一致。
- 地点被拼接进正文，无法筛选或单独展示。
- 单帖只能有一张图或一个视频。
- 推荐页只是取列表，关注页没有真实关注过滤。
- 没有草稿、收藏、举报、可见性和审核状态。

### 9.2 数据结构建议

```sql
posts(id, user_id, observation_id, title, body, location_text,
  visibility, moderation_status, published_at, created_at, updated_at, version)
post_media(id, post_id, media_id, type, sort_order, width, height, duration_ms)
post_likes(post_id, user_id, created_at, PRIMARY KEY(post_id, user_id))
post_bookmarks(post_id, user_id, created_at, PRIMARY KEY(post_id, user_id))
post_comments(id, post_id, user_id, parent_id, body, status, created_at, updated_at)
post_reports(id, post_id, reporter_id, reason, detail, status, created_at, handled_at)
```

如果产品保留“有帮助”“好奇”两种互动，就在 UI 明确命名；如果 UI 只显示点赞，则后端应增加或统一为 `like`，不要用文案掩盖数据含义。

### 9.3 Feed 接口

```text
GET /api/v1/feed?type=recommended&cursor=&limit=20
GET /api/v1/feed?type=following&cursor=&limit=20
```

推荐流第一版可以采用可解释排序：

```text
score = 新鲜度 * 0.40
      + 互动率 * 0.25
      + 媒体完整度 * 0.10
      + 用户兴趣鸟种匹配 * 0.15
      + 地区/季节匹配 * 0.10
```

必须加入：

- 同一作者连续出现上限。
- 用户已看内容降权。
- 被举报、审核中、私密内容过滤。
- 推荐原因可记录但不暴露内部敏感参数。
- 冷启动时用近期优质公开帖子，并做稳定随机，不要每次刷新完全乱序。

## 10. 发布、媒体和草稿

### 10.1 发布接口

推荐将媒体上传与帖子创建分开：

```text
POST /api/v1/uploads/presign
POST /api/v1/posts
PATCH /api/v1/posts/:id
DELETE /api/v1/posts/:id
GET /api/v1/posts/:id
```

`POST /posts` 请求示例：

```json
{
  "title": "清晨遇到一只翠鸟",
  "body": "它停在溪流边的枝条上。",
  "locationText": "杭州·西湖公园",
  "observationId": "obs_xxx",
  "mediaIds": ["media_xxx"],
  "visibility": "public"
}
```

发布成功后后端负责：验证媒体归属、事务写入、创建作者自己的 feed 事件、给关注者创建通知任务、清除对应草稿。

### 10.2 草稿

当前草稿只在 `localStorage`，换设备或清理浏览器就会丢失。

新增：

```sql
post_drafts(id, user_id, title, body, location_text, media_json,
  client_updated_at, created_at, updated_at, version)
```

接口：

```text
GET    /api/v1/drafts
POST   /api/v1/drafts
PATCH  /api/v1/drafts/:id
DELETE /api/v1/drafts/:id
POST   /api/v1/drafts/:id/publish
```

前端每次输入停止 1.5 秒后自动保存，使用 `version` 处理多个标签页或多设备冲突。离线时先写本地队列，联网后再同步。

### 10.3 媒体处理

- 图片限制格式、像素和大小，生成 WebP/AVIF 缩略图。
- 视频上传采用直传对象存储和分片上传，不通过 12MB JSON Base64。
- 服务端异步转码 H.264/AAC MP4 或 HLS，生成封面。
- 媒体状态：`uploading -> processing -> ready/failed`。
- 删除帖子时先软删除，异步清理无引用媒体。
- URL 使用 CDN 或短期签名地址；私密观测图不能设为永久 public cache。

## 11. 评论、问题、点赞与收藏

现有评论、问题和 reaction 已具备基础接口。应补充：

- 评论回复 `parentId`，最多建议两层展示。
- 评论编辑、删除后的占位状态。
- 点赞/取消点赞使用 PUT/DELETE 幂等接口。
- 收藏仅自己可见。
- 防刷限流、重复内容检测和敏感内容审核。
- 帖子详情返回当前用户状态：`liked`、`bookmarked`、`followingAuthor`。

推荐接口：

```text
PUT    /api/v1/posts/:id/like
DELETE /api/v1/posts/:id/like
PUT    /api/v1/posts/:id/bookmark
DELETE /api/v1/posts/:id/bookmark
GET    /api/v1/posts/:id/comments?cursor=
POST   /api/v1/posts/:id/comments
PATCH  /api/v1/comments/:id
DELETE /api/v1/comments/:id
```

计数更新要在数据库事务中完成，或实时 COUNT 后配缓存；不能只在前端把数字 `+1` 当作最终状态。

## 12. 消息中心

当前消息页面是前端硬编码示例，必须由后端提供。

新增表：

```sql
notifications(
  id, recipient_user_id, actor_user_id, type,
  entity_type, entity_id, payload_json,
  read_at, created_at
)
notification_preferences(
  user_id, likes_enabled, comments_enabled, follows_enabled,
  system_enabled, email_enabled, updated_at
)
```

消息类型至少包括：

- `post_liked`
- `post_commented`
- `user_followed`
- `comment_replied`
- `post_moderation_updated`
- `device_sync_completed`
- `system_announcement`

接口：

```text
GET  /api/v1/notifications?cursor=&unreadOnly=false
GET  /api/v1/notifications/unread-count
POST /api/v1/notifications/:id/read
POST /api/v1/notifications/read-all
GET  /api/v1/notification-preferences
PATCH /api/v1/notification-preferences
```

通知创建要幂等，例如同一人短时间连续点赞不要产生重复垃圾通知。列表里只保存实体引用和必要快照，避免帖子删除后页面完全无法解释消息。

实时性分级：

1. 第一版页面进入时拉取，导航栏每 60 秒获取未读数。
2. 第二版使用 Server-Sent Events 推送未读数。
3. 只有确实需要双向实时通信时才使用 WebSocket。

## 13. 设备页面与 Birdora Glasses

当前设备连接是 UI 模拟：点击后写 `birdora-device-connected` 到 `localStorage`，电量、存储、固件都是固定示例值。这不能代表真实硬件连接。

### 13.1 需要先确定硬件通信方案

推荐优先级：

1. 手机/桌面配套程序负责蓝牙，网站只和后端通信。这是兼容性和稳定性最好的方案。
2. 支持 Web Bluetooth 的浏览器直接连接，但必须 HTTPS、用户手势授权，并接受 Safari/iOS 等环境不支持。
3. 眼镜直接联网，通过 MQTT/HTTPS 与设备云通信。

### 13.2 后端数据表

```sql
devices(id, serial_number, model, firmware_version, owner_user_id,
  display_name, status, paired_at, last_seen_at, created_at, updated_at)
device_pairing_codes(id, device_id, code_hash, expires_at, consumed_at, created_at)
device_telemetry(id, device_id, battery_percent, storage_free_bytes,
  firmware_version, captured_at, received_at)
device_media(id, device_id, user_id, media_id, captured_at,
  sync_status, observation_id, created_at, updated_at)
device_sync_jobs(id, device_id, user_id, status, total_items,
  completed_items, error_code, started_at, completed_at, created_at)
firmware_releases(id, model, version, release_notes, file_url,
  checksum_sha256, mandatory, published_at)
```

### 13.3 接口

```text
POST   /api/v1/devices/pairing-codes/claim
GET    /api/v1/devices
GET    /api/v1/devices/:id
PATCH  /api/v1/devices/:id
DELETE /api/v1/devices/:id
GET    /api/v1/devices/:id/telemetry/latest
POST   /api/v1/devices/:id/sync-jobs
GET    /api/v1/devices/:id/sync-jobs/:jobId
GET    /api/v1/devices/:id/media?cursor=
POST   /api/v1/devices/:id/firmware-updates
```

设备页前端映射：

- `deviceConnectionTitle`：设备详情的在线状态。
- `deviceBatteryValue`：最新 telemetry 电量。
- `deviceStorageValue`：最新 telemetry 可用空间。
- `deviceFirmwareValue`：设备固件版本，并与最新发布版本比较。
- `deviceSyncStatus`：最近同步任务状态和完成时间。
- `deviceConnectBtn`：未绑定时进入配对，已绑定时不能简单等同于“断开蓝牙”；应区分暂时断连和解除绑定。

设备安全：

- 配对码一次性、短时有效、只保存哈希。
- 每台设备独立密钥，支持吊销和轮换。
- 固件必须签名，设备校验签名和 SHA-256 后才安装。
- 用户只能读取自己绑定设备的数据。
- 遥测写入限制频率，防止设备故障灌满数据库。

## 14. 个人设置、退出和注销

个人页资料保存已对接；邮件通知和公开资料开关目前只写用户表，尚未完整影响其他功能。

后端应保证：

- `publicProfile=false` 时公开用户接口隐藏简介、年龄等资料。
- `emailNotifications=false` 时邮件任务不入队，但站内必要系统通知仍可保留。
- 退出只撤销当前会话；“退出所有设备”撤销用户全部 session。
- 注销账号先二次验证，再进入短暂可恢复期或立即匿名化，具体由产品政策确定。
- 注销后清除头像、帖子媒体、观测图片、设备绑定、令牌和导出文件。
- 数据库级外键与对象存储清理任务必须共同执行，失败可重试并可审计。

## 15. 内容审核、举报与青少年隐私

网站可能包含青少年用户和自然位置数据，默认采用数据最小化：

- 不公开邮箱、精确年龄、精确 GPS、设备序列号和登录 IP。
- 上传图片先剥离 EXIF；特别是 GPS、设备型号和拍摄者信息。
- 对鸟巢、繁殖地和保护物种的坐标做网格化、延迟或完全隐藏。
- 个人简介、帖子、评论、图片和视频均需要审核入口。
- 用户可拉黑他人，拉黑后双方内容和互动按产品规则隐藏。
- 管理操作写审计日志，审计日志不可由普通管理员修改。

新增：

```sql
user_blocks(blocker_id, blocked_id, created_at)
content_reports(id, reporter_id, target_type, target_id, reason, detail, status, created_at)
moderation_actions(id, moderator_id, target_type, target_id, action, reason, created_at)
audit_logs(id, actor_id, action, target_type, target_id, metadata_json, created_at)
```

不能仅依赖前端隐藏按钮；权限和可见性必须由后端查询条件强制执行。

## 16. 前端页面逐页对接清单

| 页面/板块 | 当前状态 | 需要的后端 |
|---|---|---|
| 首页森林大标题 | 静态内容，日期前端生成 | 可选首页配置、每日地点推荐 |
| 首页路线图 | 纯导航 | 无业务接口；可选记录匿名点击分析 |
| 识别上传区 | 浏览器模型 + 服务端识别 | 识别任务、媒体上传、模型版本 |
| 识别结果卡 | 临时前端状态 | 确认识别并创建观测 |
| 搜索鸟种 | 静态 JSON 搜索 | species 搜索、详情、图片许可信息 |
| 滚动图例 | 静态/外链图片 | 热门鸟种、地区季节排序、CDN |
| 观鸟提示 | 静态内容 | 可选 CMS；不需要强制动态化 |
| 社区推荐 | 普通列表/示例 | 推荐 feed、曝光去重、审核过滤 |
| 社区关注 | 未真实实现 | follows + following feed |
| 社区发布 | 帖子 API 已有，草稿本地 | 独立地点、云草稿、对象存储、多媒体处理 |
| 右侧笔记速览 | 当前帖子列表截取 | 推荐接口的精简字段或同一 feed 复用 |
| 社区消息 | 硬编码 | notifications、未读数、已读接口 |
| 个人页 | 资料保存已实现 | 公开主页、统计、会话、密码和偏好完善 |
| 设备页 | `localStorage` 模拟 | 配对、设备详情、遥测、同步、固件 |
| 注册/登录 | 已实现 | 邮箱验证、重置密码、会话管理 |
| 隐私/条款 | 静态 | 文档版本和用户同意记录 |

## 17. 前端统一 API 层改造

目前 `authRequest`、`community-api.js`、`observation-api.js` 分散处理请求。建议抽成：

```text
assets/js/api/client.js          通用 fetch、超时、错误、requestId
assets/js/api/auth.js            认证与账号
assets/js/api/species.js         图鉴
assets/js/api/recognitions.js    识别任务
assets/js/api/observations.js    观测记录
assets/js/api/community.js       feed、帖子、评论、点赞、关注
assets/js/api/notifications.js   消息
assets/js/api/devices.js         设备
```

统一客户端必须：

- `credentials: "include"`。
- 15 秒默认超时，上传接口单独更长。
- 401 时清理前端用户状态并跳转登录，但避免无限重定向。
- 展示后端 `fieldErrors`，不要只显示“请求失败”。
- 保留 `requestId` 供用户反馈和服务端查日志。
- GET 可安全重试；POST 只有带 `Idempotency-Key` 时自动重试。
- 处理 429 的 `Retry-After`。
- 不把 Cookie、密码、Base64 图片写到控制台。

## 18. 数据库迁移与备份

当前 `database.js` 在启动时直接 `CREATE/ALTER/DROP`。原型可用，生产应改为版本化迁移工具。

要求：

- 每次 schema 变更有迁移编号、向上迁移和回滚说明。
- 部署前自动备份，迁移失败停止发布。
- PostgreSQL 使用连接池和事务。
- 数据库每日备份，定期实际演练恢复。
- 对象存储开启版本控制或生命周期策略。
- 备份加密，权限与生产服务账号分离。
- `app/data/birdora.sqlite`、上传目录、`.env` 不应提交 GitHub。

## 19. 安全基线

- 生产必须设置长随机 `JWT_SECRET`、准确的 `ALLOWED_ORIGINS` 和 `Secure` Cookie。
- Cookie：`HttpOnly`、`Secure`、合适的 `SameSite`、明确 Path 和过期时间。
- 所有写请求做 Origin/CSRF 防护。
- 登录、注册、重置密码、媒体上传、评论、关注分别限流。
- 请求体、字符串长度、数组数量、图片像素、视频时长都在后端校验。
- SQL 全部参数化；输出到 HTML 前转义。
- 文件名由服务端生成，禁止用户路径参与磁盘拼接。
- 依赖定期审计，生产日志不包含密码、Cookie、令牌、Base64 或精确坐标。
- 管理接口使用独立角色权限，不用前端是否显示按钮判断管理员。
- 设置 CSP、HSTS、`X-Content-Type-Options: nosniff` 和合理的 Referrer-Policy。

## 20. 可观测性与运维

每个请求已有 request ID，继续补充：

- 结构化日志：路由模板、状态码、耗时、用户匿名 ID、错误码。
- 指标：请求量、P95/P99、错误率、识别耗时、上传失败、队列积压、数据库锁等待。
- 业务指标：注册成功率、识别确认率、发布成功率、同步成功率；不包含积分。
- 告警：5xx、数据库不可用、对象存储失败、识别模型加载失败、磁盘不足。
- 健康检查分为 `/health/live` 和 `/health/ready`，ready 要检测数据库和关键依赖。

## 21. 测试方案

### 21.1 单元测试

- 字段边界、邮箱和密码校验。
- 文件签名、大小和像素限制。
- 推荐过滤、隐私过滤和权限判断。
- 关注幂等、点赞幂等、通知去重。
- 设备配对码过期和重复使用。

### 21.2 API 集成测试

- 注册 -> 登录 -> 修改资料 -> 退出 -> 再登录 -> 注销完整链路。
- 上传 -> 识别 -> 确认 -> 保存观测 -> 发布帖子完整链路。
- A 关注 B，B 发帖后 A 的关注流和通知正确。
- 私密观测不能被其他用户读取图片 URL。
- 删除用户后数据库记录和媒体文件均被清理。
- 相同 Idempotency-Key 不产生重复资源。

### 21.3 浏览器端到端测试

- 桌面和移动端分别测试所有页面。
- 未登录、登录、接口超时、401、429、500、离线恢复。
- 上传错误格式、大文件和损坏文件。
- 发布草稿跨刷新恢复和跨设备同步。
- 消息已读后未读数同步下降。
- 真实设备不可用时，设备页给出明确状态，不伪造已连接数据。

### 21.4 性能目标建议

- 普通 GET API P95 小于 300ms。
- Feed 首屏 P95 小于 500ms，不含媒体下载。
- 图片缩略图通过 CDN，首屏避免加载原图。
- 识别接口单独定义模型相关 SLO，并显示排队/处理中状态。
- 50 并发用户压测后无 SQLite 锁错误；生产迁移 PostgreSQL 后重新定基线。

## 22. 分阶段实施顺序

### 阶段 A：稳定现有后端

1. 写 OpenAPI 3.1 文档并统一错误格式。
2. 把启动时数据库变更迁到版本化 migrations。
3. 给现有 auth、observations、community、recognition 补集成测试。
4. 媒体改 multipart 或对象存储，去除 JSON Base64 主流程。

### 阶段 B：完成当前 UI 对应能力

1. follows 和 following feed。
2. notifications 和未读数。
3. 云端 drafts、独立 location 字段和标准 like。
4. 个人统计和公开资料。
5. species 搜索接口。

### 阶段 C：接入硬件

1. 明确蓝牙/配套程序/设备云协议。
2. 实现设备配对、设备列表和 telemetry。
3. 实现照片同步任务。
4. 实现固件签名、版本检查和升级状态。

### 阶段 D：生产化

1. PostgreSQL、Redis、对象存储、CDN。
2. 内容审核、举报、拉黑和管理后台。
3. 邮件验证、密码重置和多会话管理。
4. 监控、告警、备份恢复和灾难演练。

## 23. 每个功能的完成定义

一个功能不能只以“页面能点”为完成标准。至少满足：

- 数据库 schema 和迁移已提交。
- 接口请求/响应和错误码写入 OpenAPI。
- 前端不再依赖硬编码或 `localStorage` 伪造服务器状态。
- 后端完成身份、归属、权限和字段校验。
- 成功、空数据、加载、超时、无权限、限流和服务器错误状态均有 UI。
- 单元、API 集成和浏览器 E2E 测试通过。
- 日志不泄露敏感数据，关键指标可观测。
- 删除和注销能清理关联数据及媒体。
- 桌面端和移动端完成视觉与可用性检查。

完成以上标准后，Birdora 的前端页面、社区、识别、个人资料和设备管理才算真正由后端可靠支撑，而不是仅在当前浏览器中表现正常。
