# Birdora 网站后端开发路线图

> 文档性质：源码事实审计 + 可执行建设路线；后续章节保留锁定提交的审计事实，当前实现进度以“当前落地状态”为准
> 审计基线：`deploy-temp/feature/v1.7.0-front-plus` / `896c453019581de0c46948fd724311d606017fa0`（2026-07-10）
> 开发工作树：`C:\Users\Administrator\Documents\逸轩_开发\worktrees\birdora-web-backend`（`feature/v1.7.0-front-plus`）
> 编制日期：2026-07-12
> 需求输入：`birdWEB后端更新对接.txt`、下载版与仓库版 `BACKEND_INTEGRATION_PLAN.md`
> 事实优先级：锁定提交中的源码与部署配置 > 可执行测试 > 交接文档。两份 `BACKEND_INTEGRATION_PLAN.md` 正文相同，仅换行符不同。

说明：锁定提交中的 `package.json:3` 与 `CHANGELOG.md` 仍停留在 1.6.0，README 也未记录新增视频/资料契约；当前开发分支已把 package 版本更新为 1.7.0。本文仍把锁定 commit 称为“v1.7 功能基线”，不把分支中的未发布开发状态误判为已完成的正式 v1.7 release。

## 当前落地状态（2026-07-12）

本节记录 `feature/v1.7.0-front-plus` 工作树的实际开发状态；本文其余“当前能力/现有接口”表格仍是对锁定提交 `896c453` 的审计快照。本项目是 **Web 网站（静态 Web 前端 + Express API）**，不是微信小程序，也不采用小程序接口或云开发运行时。

- **阶段 0 代码基线已完成：** 资料与偏好改为稀疏更新，显式保留 `false/null/empty`；高风险发布、编辑、旧 reactions 点赞和账号注销均由 runtime capabilities + 服务端开关双重 fail-closed；following/messages/demo 不再用全量、随机或硬编码数据冒充真实功能；浏览器草稿按登录用户隔离；社区图片 1 MiB、视频 8 MiB、路由 parser 14 MiB 与 Nginx 16 MiB 已对齐；有请求体的写接口只接收 JSON 对象。旧发布/编辑/点赞仍只是显式开启后的兼容路径，不代表可靠发布、权威点赞或生产注销已经完成。
- **迁移基线已推进到 V009：** V001-V009、`schema_migrations` checksum、一次性 legacy JSON 导入标记、并发迁移回归、严格只读 `pnpm db:preflight`、显式 `pnpm db:migrate`、验证 SQLite 快照，以及 `/api/health/live`、`/api/health/ready` 已实现。V003-V009 均为只增不删迁移，覆盖运行基础、关注、帖子策略、权威点赞、草稿发布、审核基础表与通知；旧业务行原地保留，旧 helpful reaction 可回填到 canonical like。生产普通 server 不自动迁移，只有显式 migration command 可 apply。
- **阶段 2 已完成本地实现与接口测试：** 公开资料隐私裁剪、关注/取消关注、粉丝/关注游标列表、确定性 recommended/following feed、个人统计/帖子和 `PUT/DELETE like` 已接到网页前端。详情、评论/提问列表以及图片/视频直链统一执行 public/followers/private 可见性，私密媒体使用 `private, no-store`。
- **阶段 3 的举报/人工审核本地闭环已完成：** 云草稿与发布事务之外，现已实现举报去重、审核队列/详情、访问与决定审计、hide/restore 状态机、受控 moderator CLI、作者通知及网页举报/审核工作台。举报不会按数量自动隐藏。基础文本/媒体 safety、revision 编辑和预发布运营演练仍未完成，所以正式生产发布开关继续关闭。
- **阶段 4a 的通知 REST 与 Outbox 基础已完成本地实现：** 关注、点赞和评论通知及消息中心已落地；同进程 worker 具备领取租约、过期重领、指数退避、死信、脱敏错误、容量门禁和 activation journal 暂停，`post.moderation_changed` 已接通。媒体删除/注销 consumer、周期轮询和 SSE 尚未完成。
- **A/B 发布控制代码已编写，但还不是获准执行的生产流程：** signed immutable runtime/public release、外置严格配置、专用 PM2、全局部署锁、数据库 shared/exclusive 生命周期锁、14 相位 activation journal、verified marker 和 forward-fix 失败策略已经接通。失败保持 maintenance 并停止候选；migration 可能开始后不自动切回 runtime 或启动旧代码，只有 public pointer 可依据落盘事实安全恢复。
- **生产发布仍有两个相互独立的硬阻断：** 第一，当前线上仍可能是共享可变目录与旧 PM2_HOME，日常 updater 会要求已经存在一致的 immutable runtime/public pointers、受管 marker 和旧签名证据，因此需要单独审核的 legacy adoption 流程；该流程尚未完成。第二，截至 2026-07-12，真实构件和 shell 尚未在目标 Ubuntu 通过 Bash/Nginx/PM2/`ss`、`/proc` 锁语义、文件系统持久化和逐相位故障注入。journal 固定在 `/var/lib/birdora-control/activation-pending.json`，任一残留只能 fail-closed 并人工 reconciliation。
- **下一业务阶段是内容安全、媒体生命周期与预发布验收：** 举报/人工审核和 Outbox 基础已完成本地实现；下一步把媒体清理/注销接入 worker，补基础文本/媒体 safety、revision 编辑、通知轮询/SSE，再做可访问预发布浏览器和 Ubuntu 故障演练。设备配对、眼镜同步、图鉴 CMS 和密码找回仍是独立后续范围。

阶段 0 的“真实 Nginx 代理下 8 MiB 边界”、生产配置和浏览器主流程仍须在部署候选环境做 smoke/验收；自动化通过不能替代该部署验收。

### 线上 SQLite 热更新 / 回退 Runbook（强制）

线上 SQLite 已有真实用户、帖子和观测数据，因此当前单机形态不承诺无维护窗口的“热更”。每次代码或 schema 变更都必须先安排维护窗口，并把“停止新写”作为 release bundle、备份与 migration 的硬前置：

> **现有 legacy 部署拓扑不能直接执行本 runbook。** 当前 updater 只接受已经拆分到 immutable runtime/public release、专用 PM2_HOME 和 control/protected 目录的受管主机；共享可变目录必须先经单独审核的 legacy adoption，不能靠日常更新脚本猜测或覆盖完成。

1. **在生产机外冻结并签名 release，再由受信 launcher 串行部署。** live 与 candidate 是两个 immutable 物理目录；candidate 的依赖物化、测试、审计、构建证据和签名都不得修改 live release。生产配置不进入 `.env`，只由 `/usr/local/libexec/birdora/run-with-production-env.js` 严格解析；launcher 取得 root-only `/var/lock/birdora-web.deploy.lock` 后才进入控制器。
2. **先封旧直连端口并核实升级前版本。** 若 `ss` 显示旧 API wildcard 监听，必须先在安全组与主机防火墙阻断公网 TCP 3003。旧版本必须由 current marker、runtime pointer、live PID cwd、专用 PM2 inventory 和旧签名 manifest 一致证明；不能用 `HEAD^`、候选分支或当前工作树猜测。没有受管 marker 的旧主机必须停止并走 legacy adoption。
3. **只读 preflight 与空库防误建。** 核对 ledger/checksum/fingerprint、current/target/pending、完整性、业务表计数、容量以及 DB device/inode。现有 PM2、runtime pointer 或 `/var/lib/birdora-control/current-release.json` 存在时，缺失/空数据库、路径或 inode 漂移都硬失败；不能用首装开关绕过现网丢库。
4. **持久化全站 maintenance 后双重排空。** 创建 `/var/lib/birdora-maintenance/maintenance.flag`，安装候选 Nginx 配置并先过 `nginx -t`。reload 后追踪 reload 前 worker PID，等待旧 Nginx worker 全部退出；API、社区发布、首页与静态资源都必须证明返回维护 `503`。然后排空 3003 已建立连接、停止旧 PM2 并确认端口关闭。任一 worker/连接未排空时都不得迁移。
5. **连续排他锁覆盖 bundle、备份和 migration。** 旧 writer 停止后，控制器持有 `/var/lock/birdora-db-maintenance.lock` 的连续排他 FD。恢复材料写入 `/var/lib/birdora-protected`；SQLite 快照、manifest/SHA-256 与媒体证据全部 fsync 后，才把 `/var/lib/birdora-control/activation-pending.json` 置为 `migration-about-to-start` 并显式迁移。无 pending 的纯代码发布也不例外。
6. **用持久 journal 协调 migration/runtime/static 激活。** migration 命令完成和 DB postflight 完成后分别原子推进 journal；postflight 要求 DB 存在、非空、无 pending、current=target，且既有业务表行数与停写前精确对账。journal 覆盖 migration 开始前到 verified marker 提交之间 shell trap 无法处理的断电/SIGKILL。达到 `database-migrated-candidate-not-yet-verified` 后才切换 runtime pointer/PM2 cwd、启动候选并验证 ready/PID/loopback，然后把完整静态网站写入唯一 staging 目录、生成 manifest，并原子切换静态 symlink。禁止对活动 release 逐文件覆盖。
7. **验证成功后最后写 release marker，再清 journal。** maintenance 解除后先要求公开读请求 `200` 且写请求仍由 journal 返回 `503`。只有所有身份一致，才原子写并 fsync `/var/lib/birdora-control/current-release.json`，随后推进 `marker-committed`、删除 journal 并 fsync control 目录。残留 journal 必须 fail-closed。migration 可能开始后的失败停止候选、保持维护/只读且不自动切回 runtime 或启动旧 API；public pointer 可按实际状态安全恢复。V002 仅记录 legacy retirement deferred，不 DROP 旧表。

### 回退政策：只允许 forward-fix

当前没有安全的“启动旧版”回退，策略是 **forward-fix-only**：

1. 审计基线 `896c453019581de0c46948fd724311d606017fa0` 的旧启动路径会执行 `DROP TABLE IF EXISTS user_point_events`。严禁把该 commit 或仍带相同启动 DDL 的构建指向迁移后、恢复后或任何真实生产数据库；否则会重新引入已明确移除的破坏性 DDL。
2. bundle 中的旧 marker、旧签名 manifest、脱敏 PM2/Nginx 元数据只用于证明升级前事实、审计差异与构造 forward fix，`executableRollbackAllowed=false`；它们不是可执行回滚包。
3. 候选失败后保持全站 maintenance 并停止候选 PM2。public 指针可依据实际状态恢复；migration 可能开始后 runtime 指针留在已停止的 forward-fix candidate，旧 API 不自动启动。残留 journal 时先人工 reconciliation，核对迁移、快照、bundle、PM2 cwd 与两个指针，再制作当前 schema 兼容的新 forward-fix release。
4. 只有经独立批准的灾难恢复，才可在离线副本上使用 bundle 的自包含 `VACUUM INTO` SQLite 与同点媒体。自包含快照不能附加旧 WAL；若另选 raw SQLite 副本，主 DB 与匹配的 `-wal` 必须成套恢复，禁止混用时间点。恢复完成后也只能启动已审计的安全 runtime，不能启动旧 `896c453`。

如果新候选解除 maintenance 后已经产生真实写入，直接恢复发布前快照会丢失这些写入。此时必须重新进入维护，先导出并人工核对增量，再决定 forward migration、数据合并或经业务负责人批准的数据损失范围；不得把“恢复旧快照”描述为无损一键回滚。

### 目标 Ubuntu 发布前故障验收（硬门槛）

**截至 2026-07-12，A/B 发布控制代码已实现，但 legacy adoption 与目标 Ubuntu 真实运行/故障证据尚未完成；当前未达到生产执行条件。** Windows 静态测试和 Node 单测不能证明这些语义。第一次生产执行前，必须在与目标机同版本的隔离 Ubuntu/候选机完成并保存证据：

- 用 immutable release A 运行 live PM2，在完全独立的 release B 预装依赖和测试，证明 A 的源码、依赖、权限与 cwd 未变；在 maintenance 内原子切换 runtime pointer/PM2 cwd 到 B，并验证新 PID 的 `/proc/<pid>/cwd`。共享 APP_DIR 形态必须在候选依赖验证前硬失败。
- `bash -n` 校验并实际运行 `install-http.sh`、`create-rollback-bundle.sh`；并发运行两个 installer，证明 `flock` 只允许一个进入。`nginx -t` 后验证 maintenance flag 对 API、社区 16 MiB location、首页和静态资源都返回维护 503；记录并证明 reload 前 Nginx worker 已排空。
- 用 `ss -lntp` 证明新 PM2 PID 只绑定 `127.0.0.1:3003`，并从外部主机证明公网 TCP 3003 不可达；旧 wildcard listener 的升级必须验证 firewall 先于确认 flag 生效。
- 在有 PM2、runtime pointer 或 current marker 的候选状态分别注入缺失 DB、空 DB、错误路径/inode，确认脚本在创建新库前失败。
- legacy adoption 分别注入缺失、伪造和一致的旧版本证据，证明前两者在 snapshot/migration 前失败；检查流程从不推断 `HEAD^`。后续升级证明 marker、签名、PM2 cwd 和 runtime pointer 必须一致。
- 注入首次 preflight/空库/错误路径失败，确认脚本在写库和进入 maintenance 前退出、旧服务状态不变；再分别注入停写后 preflight、磁盘容量、媒体归档、独立 `db:backup`、pin/checksum、migration、postflight、候选 ready、runtime/static staging/manifest/指针切换、Nginx/public transport 和 marker 写入失败。确认 maintenance 持续存在或恢复、候选 PM2 停止、已切换的指针恢复、旧 API 不自动启动、日志与不完整 bundle 可审查。
- 从 migration 即将开始到 marker/journal 清理之间的每个关键边界注入断电/SIGKILL。journal 必须以原子 rename + fsync 创建并逐阶段推进；任一残留都使新部署 fail-closed 并恢复/保持 maintenance，直到人工核对 DB、PM2 cwd、runtime/static 指针、bundle 和 marker。成功 marker 原子提交并 fsync 后才能删除 journal，再 fsync 数据目录。
- 执行一次无 pending 的纯代码发布，确认 migration 前已生成并固定 `database-before-update.sqlite`/manifest/SHA-256，bundle 同时包含 community + observations 媒体清单、配置和旧 release 审计元数据；验证静态 release 是完整 staging 后一次原子切换，不出现新旧文件混搭。
- 证明 `current-release.json` 只在公开 API 和首页均为 200 后最后原子写入，且 `activationVerified=true`；journal 仅在 marker 持久化后清除。从 bundle 做离线 DB/两类媒体恢复并只用安全 forward-fix runtime 完成 `integrity_check`、`foreign_key_check`、关键表行数、媒体 hash、Nginx 与 ready 验收。绝不启动旧 `896c453`；演练未通过不得解除生产发布阻断。

## 0. 结论与执行顺序

当前项目不是“从零建设后端”，而是一个可继续演进的单机模块化单体：

```text
Nginx 静态站点 public/
  └─ /api/* -> Express 4 / Node.js CommonJS
                  ├─ node:sqlite DatabaseSync（WAL，单进程）
                  ├─ 本机 community / observations 媒体目录
                  ├─ JWT HttpOnly Cookie + revoked_tokens
                  └─ 本机 ONNX Runtime 识别
```

现有 auth、观测记录、识别、社区帖子、评论、提问、图片/视频、关注、真实 feed、云草稿、权威点赞、通知、帖子可见性、举报/人工审核和可靠 Outbox 基础已经落地；完整内容安全、媒体生命周期和生产环境证据仍不存在。v1.7.0 引入的数据覆盖、隐私开关反转和上传限额错配已经在当前工作树修复，但尚未发布到生产。

本路线固定按以下顺序推进：

1. **阶段 0：先修 v1.7.0 对接错配**。
2. **阶段 1：稳定后端基线**，先有版本化迁移、统一契约、可恢复媒体和安全基线。
3. **阶段 2：公开资料 / 关注 / Feed / 权威点赞**。
4. **阶段 3：云草稿 / 发布事务 / 举报审核 / 可见性与内容安全**。
5. **阶段 4：通知 / Outbox / 轮询，再加 SSE**。
6. **阶段 5：生产化**，按触发条件迁移 PostgreSQL、对象存储和分布式基础设施。

MVP 定义为阶段 0 至阶段 4a（通知 REST + 条件轮询）全部验收通过；阶段 4b 的 SSE 是同一产品版本的实时增强和轮询替代路径。WebSocket、个性化机器学习推荐、聊天、多区域和微服务不在 MVP。

**积分功能永久退役，但线上旧表先保留。** 不得在 DTO、API、Outbox 事件、通知、统计或推荐特征中重新引入任何积分字段或积分事件；V002 不自动 `DROP user_point_events`。旧表只允许在人工核对无依赖、取得一致性备份并结束回滚观察窗后，由单独获批的后续版本归档/删除。

## 1. 审计范围、方法与非目标

### 1.1 已核对源码

- 启动与部署：`server.js`、`package.json`、`Dockerfile`、`compose.yaml`、`ecosystem.config.cjs`、Nginx 与环境模板。
- 数据库：`app/db/database.js` 的建表、补列、触发器、旧 JSON 导入和启动时 DROP。
- 认证：auth routes/controller/service、JWT、密码 worker、token revocation、Cookie 与 Origin Guard。
- 社区：community routes/controller/service、图片/视频、评论、问题、reactions、分页和文件清理。
- 观测与识别：observations、recognition 的路由、校验、所有权、模型调用和媒体路径。
- 最新前端真实调用：根目录与 `public/` 中的 `script.js`、`community-api.js`、`community.html`、`profile.html`。两套文件当前哈希一致；`scripts/sync-public.js` 以根目录文件为源同步到 `public/`。
- 测试：auth、community、observations、recognition、browser E2E 与部署/负载脚本的静态覆盖。

### 1.2 本路线包含

- 用户私有资料的可靠持久化与严格白名单的公开资料。
- 关注/取消关注、关注列表、粉丝列表。
- 推荐发现流和关注流、帖子权威持久化、幂等单一点赞。
- 云草稿、媒体归属、幂等发布事务、失败清理。
- 举报、审核状态、可见性、最小内容安全和管理审计闭环。
- 通知列表、未读数、单条/全部已读，以及通知实时更新。
- SQLite 单机阶段的可靠性基线与向 PostgreSQL/对象存储的演进路径。

### 1.3 明确不在本轮 MVP

- 设备配对、蓝牙、遥测、固件和眼镜照片同步。
- 图鉴 CMS、图鉴搜索后端、首页地点推荐。
- 邮箱验证、忘记密码、多设备会话管理和真正的邮件投递。
- 收藏、私信/聊天、在线状态、评论多级树、复杂风控和 ML 推荐。
- 多实例、Redis、Kafka、独立微服务和多区域容灾。

上述能力可以在阶段 5 之后单独立项，不能扩大本轮发布、关注和通知的交付边界。

## 2. 当前能力矩阵

| 领域 | 锁定提交中的真实能力 | 关键缺口/风险 | 目标阶段 |
|---|---|---|---|
| 运行形态 | `package.json` 约束 Express `^4.21.2`，锁文件实际 4.22.2；Node >=24.14、CommonJS；PM2 单实例 fork | 同步 SQLite 与同步文件 I/O 不适合横向扩容，但当前无需拆服务 | 1、5 |
| 启动/健康 | `/api/health` 仅返回进程时间；DB 在 `getDatabase()` 首次调用时才初始化 | DB/迁移失败时 health 仍可 200；没有 readiness | 1 |
| 数据库 | `DatabaseSync`、WAL、`busy_timeout=5000`；现有 users、tokens、posts、reactions、comments、questions、post images/videos、observations | 启动时直接 CREATE/ALTER/trigger/DROP，无 `schema_migrations`；新旧库物理约束可能分叉 | 1 |
| 旧数据迁移 | 每次首次触库都读 `users.json`、`revoked-tokens.json` 并 `INSERT OR IGNORE` | 无完成标记；旧 JSON 保留时，已注销用户可能在重启后被重新导入 | 1 |
| 积分退役 | 每次初始化执行 `DROP TABLE IF EXISTS user_point_events` | 破坏性 DDL 在运行时重复执行 | 1：先移除运行时 DROP 并保留旧表；人工核对后的独立版本再归档/删除 |
| 会话/鉴权 | JWT HttpOnly Cookie，也接受 Bearer；revoked_tokens；生产弱 secret fail-fast | JWT 未固定 algorithms/issuer/audience；只能撤销当前 jti；无显式 CSRF token | 1 |
| CORS/CSRF 基线 | 精确 allowlist CORS + credentials；所有非安全方法校验 Origin/Referer | 仅 Origin + SameSite=Lax；状态写入还没有会话绑定 CSRF token | 1 |
| 用户资料 | users 已有 bio/gender/age/avatar_url/email_notifications/public_profile；`PATCH /api/auth/profile` 和注销已存在 | PATCH 实际全量覆盖；头像 Base64 入库；没有公开 DTO/公开接口；`publicProfile` 未被消费 | 0、2 |
| 注销 | 密码 + 固定确认文本；users 级联删除 | 只清社区图/视频，不清 observation 文件；DB 已删后文件删除失败不可重试；只撤销当前 token | 0、1 |
| 公开资料/关注 | 无 | 无公开主页、关注表、关注/粉丝列表或隐私执行 | 2 |
| 社区帖子 | 帖子、编辑、删除、作者所有权、评论、问题均落 SQLite | 无 location 独立字段、publication status、visibility、moderation、report | 2、3 |
| 帖子列表 | 全量按 `created_at,id` 倒序，limit/offset；游客可读 | 不是推荐/关注 feed；offset 会在新增内容时重漏；没有可见性/审核过滤 | 2 |
| 图片 | JPEG/PNG/WebP，真实签名前缀校验，<=1 MiB，本机文件 | 前端新 composer 允许 8 MiB；无像素/完整解码/EXIF 清理/配额 | 0、1、3 |
| 视频 | MP4/WebM，前缀校验，<=8 MiB，`GET /:id/video` | Nginx 仅 3 MiB，8 MiB Base64 约 10.7 MiB，线上请求到不了 Express；写失败可能留残片 | 0、1、3 |
| 媒体读取 | 社区图片/视频公开，`Cache-Control: public, immutable`；观测图仅所有者 | visibility/审核上线后，公开媒体 URL 会绕过策略；无统一资产账本 | 1、3 |
| reactions | helpful/curious 均落库，数据库 GROUP BY 是当前权威计数 | 新 UI 文案只有“赞”；旧 toggle 先查后改、非幂等；同一用户可同时两种 | 0、2 |
| 草稿 | 新 composer 只用 localStorage 保存 title/location/body | 不跨设备、不保存媒体、无 owner/version/过期清理 | 3 |
| 发布事务 | 现有创建帖会在 SQLite 事务写帖子和媒体元数据 | 文件先落盘、后开事务；崩溃可留孤儿；四个前端入口均绕过未来审核状态 | 3 |
| 消息/通知 | 无；页面四条消息硬编码 | 无未读、已读、偏好、去重、实体引用 | 4 |
| 实时 | 无服务端推送 | 推荐/点赞无需 WebSocket；通知需要先轮询、后 SSE | 4 |
| 观测记录 | 私有创建/列表/详情/图片/删除；关联帖子时禁止删除 | offset；客户端自报识别来源/候选；账号注销遗留观测文件 | 0、1 |
| 识别 | 公开 JPEG <=1 MiB 的同步 ONNX CPU 识别 | 无并发闸门、任务状态、超时/用户额度或持久模型版本 | 1；任务化属后续 |
| API 契约 | 错误尽量补 `code/requestId`；SQL 基本参数化 | 成功包装不统一；直返 4xx、throw、rate-limit、404 形状不同；API 404 可返回 HTML | 1 |
| 分页 | posts/comments/questions/observations 使用 offset | Feed/关注列表需要 keyset cursor | 2 |
| 测试 | 现有脚本覆盖基础 auth、Origin、社区图片/互动、观测所有权、JPEG 识别 | v1.7 profile/account/video 零回归覆盖；无迁移、并发幂等、故障恢复或 CI 门禁 | 0、1 |

### 2.1 现有接口清单

全局所有非 GET/HEAD/OPTIONS 请求先经过 Origin/Referer Guard；Cookie 请求使用 `credentials:include`。下表中的“公开”表示不要求登录，不表示未来可绕过帖子可见性。

**Health/Auth**

| 方法 | 当前路径 | 鉴权/限流 | 源码事实 |
|---|---|---|---|
| GET | `/api/health` | 公开 | 只返回 ok/service/timestamp，不触库 |
| POST | `/api/auth/register` | auth IP limiter | email 手写格式校验、password 最少 8；nickname/password/email 无完整上限；成功写 Cookie |
| POST | `/api/auth/login` | auth IP limiter | email/password；成功写 JWT Cookie |
| POST | `/api/auth/logout` | 可匿名 attachSession | 已认证时撤销当前 jti，清 Cookie |
| GET | `/api/auth/me` | 必须登录 | 完整私有 user DTO |
| GET | `/api/auth/status` | 可匿名 | `authenticated + user/null` |
| PATCH | `/api/auth/profile` | 必须登录 + auth limiter | 名义 PATCH、实际全量覆盖；nickname<=40、bio<=280、age 13-100/null、gender 枚举、avatar<=600KiB |
| DELETE | `/api/auth/account` | 必须登录 + auth limiter | 当前密码 + 精确“注销我的账号”；硬删 user |

auth limiter 默认 120/15 分钟，生产 PM2 配置为 30；register/login/profile/account 共用同类桶。Cookie 为 HttpOnly、SameSite=Lax，生产 Secure。

**Community**

| 方法 | 当前路径 | 鉴权 | 源码事实 |
|---|---|---|---|
| GET | `/api/community/posts` | 可选会话 | limit 默认20/最大100 + offset；全量时间倒序 |
| POST | `/api/community/posts` | 必须 | title<=80、body<=600、bird<=80；可关联本人的 observation；图片或视频二选一 |
| GET | `/api/community/posts/:id` | 可选会话 | 帖子详情 + comments/questions 分页 |
| PATCH | `/api/community/posts/:id` | 作者 | 只改 title/body；不改 bird/media/location |
| DELETE | `/api/community/posts/:id` | 作者 | 删除 DB 后同步删文件 |
| GET | `/api/community/posts/:id/image` | 公开 | public immutable 一年 |
| GET | `/api/community/posts/:id/video` | 公开 | public immutable 一年 |
| GET/POST | `/api/community/posts/:id/comments` | GET 可选/POST 必须 | body<=180；创建返回完整 post |
| DELETE | `/api/community/posts/:postId/comments/:commentId` | 评论作者 | 帖子作者不能删除他人评论 |
| GET/POST | `/api/community/posts/:id/questions` | GET 可选/POST 必须 | body<=180；status 固定 open，无关闭/删除接口 |
| POST | `/api/community/posts/:id/reactions` | 必须 | 只接受 helpful/curious，toggle |

community 写 limiter 默认每用户 240/15 分钟。图片支持 JPEG/PNG/WebP <=1 MiB；视频支持 MP4/WebM <=8 MiB；均验证 data URL 与文件前缀。列表 item 包含 id/observation summary/title/body/bird/analysis/author/canManage/feedback/comments/questions/imageUrl/videoUrl，但没有 authorId/avatar/location/status/visibility/moderation。

**Observations**

| 方法 | 当前路径 | 鉴权 | 源码事实 |
|---|---|---|---|
| POST | `/api/observations` | 必须 | 图片必填；保存确认鸟种、置信度、Top candidates、地点、备注、来源、时间 |
| GET | `/api/observations` | 必须 | 本人列表，limit/offset |
| GET | `/api/observations/me` | 必须 | 与上一个列表重复 |
| GET | `/api/observations/:id` | owner | 私有详情 |
| GET | `/api/observations/:id/image` | owner | private max-age=3600 |
| DELETE | `/api/observations/:id` | owner | 已关联社区帖返回 409，否则 DB 后同步删文件 |

观测图片为 JPEG/PNG/WebP <=1 MiB；species<=120、scientific name<=160、location<=160、notes<=600、source<=60；confidence 0..1、Top candidates 1..5。候选、置信度和 source 由客户端提交，尚未绑定服务端 recognition job。

**Recognition**

| 方法 | 当前路径 | 鉴权/限流 | 源码事实 |
|---|---|---|---|
| POST | `/api/recognition/classify` | 公开，IP 120/15 分钟 | 仅 JPEG data URL <=1 MiB；同步 decode + ONNX CPU；返回 Top 5，不持久化 |

识别解码设 256MB 内存上限，但没有像素上限、并发 semaphore、任务队列、请求级超时、用户额度或模型版本记录。

### 2.2 现有 schema 与“迁移”事实

| 当前表 | 关键字段/约束 |
|---|---|
| `users` | id/email UNIQUE/nickname/bio/gender/age/avatar_url/email_notifications/public_profile/password_hash/timestamps |
| `revoked_tokens` | jti PK/expires_at |
| `community_posts` | user FK cascade、observation FK restrict、title/body/bird、文案 analysis、timestamps |
| `community_post_reactions` | PK(post,user,reaction_type)；同一用户可同时 helpful + curious |
| `community_post_comments` | post/user FK cascade、body/timestamps |
| `community_post_questions` | post/user FK cascade、body/status/timestamps |
| `community_post_images` | post_id UNIQUE、storage_path/name/mime/size |
| `community_post_videos` | post_id UNIQUE、storage_path/name/mime/size |
| `observations` | user FK cascade、图片元数据、鸟种/候选/地点/备注/来源/观测时间 |

`getDatabase()` 的真实顺序是：创建目录/打开 DB -> PRAGMA -> CREATE TABLE/INDEX -> `ensureColumns` ALTER -> 运行时 DROP 积分表 -> 建触发器/索引 -> 每次尝试旧 JSON 导入。它不是版本化 migration，也不是 server listen 前的统一事务。旧库通过新增列和触发器模拟部分 observation 约束，fresh schema 则带真实 FK，因此两类库可能物理结构不同。

关键源码证据：

- 惰性初始化与运行时 DDL：`app/db/database.js:155-318`。
- auth/profile/account：`app/routes/auth.routes.js:24-30`、`app/controllers/auth.controller.js:235-287`。
- 注销媒体清理：`app/services/user.service.js:100-115`。
- 社区输入上限：`app/controllers/community-post.controller.js:3-19,61-130`。
- 社区文件/事务边界：`app/services/community-post.service.js:687-866,921-965`。
- offset 全量列表与 reactions：`app/services/community-post.service.js:509-564,1031-1059`。
- 全局 12MB parser：`server.js:78-83`；生产代理 3MB：`deploy/nginx/birdora-https.conf:10`。

## 3. v1.7.0 必须先处理的对接错配

这些项目是阶段 0 的发布阻断，不应和新增关注功能混为一批。

### 3.1 资料字段被前端丢弃，可能造成隐私和数据破坏

- 后端私有用户 DTO 已返回 bio、gender、age、avatarUrl、emailNotifications、publicProfile（`app/services/user.service.js:7-20`）。
- `script.js:551-568` 的 `normalizeAuthUser` 只保留 id/email/nickname/createdAt/updatedAt。
- profile 页面又依赖被丢弃字段渲染（`script.js:4889-4911`），`undefined !== false` 会把后端的 `publicProfile=false` 和 `emailNotifications=false` 显示成开启。
- “保存资料”和“保存设置”复用同一全量 payload（`script.js:4927-4945`）；结合后端的全量覆盖语义，可能清空 bio/gender/age/avatar，并把私密档案重新公开。

阶段 0 决策：

1. 前端归一化必须无损保留 v1.7 字段，明确处理 `false`、空字符串和 `null`。
2. 完整 private user 只保存在当前页面内存；不得经 `rememberAuthUser` 写 localStorage。启动时清理旧 `birdora-auth-user/birdoraLoggedIn`，Cookie/status 仍是事实源，避免把最高 600KiB 头像、bio、age 和偏好变成长期 JS 可读数据。
3. 后端 `PATCH` 改成真正的稀疏更新：未出现的字段保持原值；显式空值才清空允许清空的字段。
4. 基本资料表单只发送基本字段；隐私/偏好操作使用稀疏 payload。`publicProfile` 仍写 profile/privacy 契约，通知偏好单独保存，三者不得互相覆盖。
5. 兼容期保留现有响应字段和路径；新增 v1 契约后旧路径调用同一 profile service。

### 3.2 “站内提醒”错误写入邮件开关

`profile.html:43-46` 的文案是“接收站内提醒”，但 `script.js:4905,4911,4935` 写入 `emailNotifications`。

阶段 0 不能把文案简单改成像已生效的“邮件通知”，因为源码只有偏好布尔值，并没有邮件投递链路。该控件应隐藏或禁用，并明确显示“邮件通知偏好（发送尚未开放）”；现有值只能准确展示，不能暗示已经发信。阶段 4 新建 notification preferences 后，再提供真实的 `inAppEnabled` 和按类型站内开关。真正邮件投递仍是后续范围；必要系统通知是否可关闭由产品确认，不能复用 `emailNotifications`。

### 3.3 前端、Express 与 Nginx 的媒体上限互相冲突

| 层 | 当前事实 |
|---|---|
| 新 composer | 图片和视频都允许 8 MiB（`script.js:4613-4615,4787-4801`） |
| 社区 controller | 图片 1 MiB；视频 8 MiB |
| Express | 全局 JSON 12 MiB |
| 生产 Nginx | `client_max_body_size 3m` |

阶段 0 兼容决策：

- 图片 UI 先与现有后端一致为 1 MiB；视频保持 8 MiB。
- 旧 Base64 视频路径只作为兼容通道：Nginx 至少 16 MiB，社区创建路由 parser 14 MiB；默认 JSON parser 降到小体积并按路由配置，避免 auth 也接受大 body。
- 阶段 3 改为 multipart 二进制上传并返回 `mediaId`；阶段 5 再改对象存储直传。届时四层上限仍由一份配置生成和测试。

具体大小、时长和单帖媒体数量仍需产品确认；未确认前不能把前端统一“8MB”当作后端契约。

### 3.4 地点拼正文会产生合法 UI、非法 API 请求

正文 textarea 最多 600 字，地点最多 80 字（`script.js:4716-4719`）；提交时变成 `body + "\n地点：" + location`（`script.js:4841`），后端 body 仍严格最多 600。

- 阶段 0：发送前按合并后的真实长度校验，避免 400；不得静默截断用户正文。
- 阶段 2 的帖子安全列迁移增加 `location_text`。
- 阶段 3 的草稿/发布契约正式发送 `locationText`，不再把地点编码进正文。
- 精确位置、敏感鸟种位置模糊规则见产品待确认项。

### 3.5 发布后的 personal 路由永远回推荐

发布后写入 `?view=personal`（`script.js:4844`），但允许集合不含 personal，渲染分支也从不调用已存在的 `renderCommunityPersonalView`（`script.js:4613,4646-4649,4745-4769`）。

阶段 0 将 personal 纳入允许集合和渲染分支，或明确跳到 profile 页；推荐采用前者，并在阶段 2 改为服务端 `/users/:id/posts` 数据。

### 3.6 following、消息、草稿和新“赞”仍是模拟状态

- following 把全量 API posts 与部分 demo 合并，不按关注关系过滤（`script.js:4655-4665`）。
- recommended 使用 `sort(() => Math.random() - 0.5)`，每次浏览器随机；API 失败又被 demo 掩盖。
- 消息完全硬编码（`script.js:4732-4742`）。
- 草稿只有 localStorage 且明确不保存媒体（`script.js:4701-4706,4804-4815`）。
- 新“赞”只改 class 和 DOM 文本（`script.js:4852-4857`），没有鉴权、请求或刷新后的持久状态。

阶段 0 处理方式：

- 生产环境不再混 demo；demo 只能显式 dev/seed 启用。API 失败必须显示错误。
- following 在阶段 2 接口上线前显示“尚未开放/空态”，不能继续展示全量帖冒充关注流。
- 新“赞”短期仅对真实帖子调用现有 `helpful` reaction，并用服务端返回重绘；demo 按钮禁用。阶段 2 切换到 canonical like。
- 消息页面在阶段 4 前标明未开放，不再渲染虚假消息。

### 3.7 页面存在重复、无用请求

- 社区页通用初始化请求一次 `GET /api/community/posts?limit=20`，workspace 又请求一次 limit=30。
- profile 页会两次请求 auth status，并额外拉取本页不显示的社区帖子。

阶段 0 合并页面 bootstrap：每页只加载自身所需资源；社区 feed 只有一个 store 和一个请求入口；profile 只请求一次当前用户。

### 3.8 注销会遗留观测媒体

users 级联会删除 observations 行，但 `user.service.deleteUser` 只枚举 community 图片/视频。没有持久 cleanup journal 时，阶段 0 无法保证 DB 与文件原子删除。因此阶段 0 增加 `ACCOUNT_DELETION_ENABLED=false` 的生产默认值，先补齐 observation inventory/回归和清楚的 `FEATURE_DISABLED` 响应；开发环境显式开启时仍只能验证 best-effort 旧路径。阶段 1 的 V003 + worker 验收后才启用可靠注销。

### 3.9 视频帖子编辑后的分析会误判“无媒体”

`app/services/community-post.service.js:882-918` 在更新帖子后重算文案分析，但 `hasImage` 只检查 `image_storage_path`，没有检查 `video_storage_path`。v1.7 视频帖编辑后会丢失“带配图/媒体”分析加分。阶段 0 的显式 dev/legacy 测试一并修正为 image 或 video；生产 `COMMUNITY_POST_EDIT_ENABLED=false`，直到 V008 revision/审核就绪，避免旧 PATCH 原地改掉已批准内容。视频同步写盘也缺少图片路径已有的 try/metric；其崩溃孤儿问题在阶段 1 的媒体 Outbox 中收敛。

### 3.10 script.js 存在同名函数覆盖

`initAuthForms`、`translateAuthMessage`、`renderUserChrome`、`escapeHtml` 等存在前后两套声明；函数提升后后面的定义生效，例如 active auth form 在 `script.js:4305-4427`，早先约 2136 行的同名实现是死定义。阶段 0 必须先用注册/登录/导航 smoke 锁定 active 行为，再删除重复定义；否则后续很容易把 CSRF/profile 修到不会执行的代码块。

## 4. 前端页面/调用 -> 现有接口 -> 目标接口映射

| 页面/动作 | 当前真实调用/状态 | 现有后端 | 目标接口/行为 |
|---|---|---|---|
| 全站功能开关 | 无 runtime capabilities；关闭的功能按钮仍显示 | 无 | `GET /api/v1/capabilities`；前端安全默认禁用，服务端仍强制 |
| 注册/登录 | active `initAuthForms` 直接 POST，未取 CSRF（`script.js:4305-4427`；前一套同名定义被覆盖） | `POST /api/auth/register\|login` | `GET /api/v1/auth/csrf` pre-auth token -> v1 register/login；成功后旋转 session token |
| 退出 | `script.js:2280-2288` POST logout，随后清本地状态 | `POST /api/auth/logout` | v1 logout 带 CSRF；即使 JWT 过期也由服务端清 HttpOnly Cookie |
| auth 展示状态 | `rememberAuthUser` 写 `birdora-auth-user` localStorage | Cookie/status 才是事实源 | private/session DTO 只存内存；清理旧 auth localStorage，不落头像/资料/偏好 |
| community 首次进入 | `/api/auth/status` 后 list limit=20；workspace 再 list limit=30 | `GET /api/auth/status`、`GET /api/community/posts` | 一次 `GET /api/v1/auth/session` + 一次 `GET /api/v1/feed?type=...`；单一 store |
| 推荐 | 全量 API 帖 + demo，浏览器随机 | 全量时间倒序 list | `GET /api/v1/feed?type=recommended&cursor=&limit=20`；MVP 为确定性的合格公开发现流 |
| 关注 | 全量 API 帖 + 部分 demo | 无 follows/filter | `GET /api/v1/feed?type=following...`；必须登录，只返回已关注作者且满足可见性/审核条件的帖子 |
| 帖子作者 | 纯文本 `<span>`，无 authorId | 响应只有 author nickname | feed 返回 author 对象；`GET /api/v1/users/:id`，作者可进入公开主页 |
| 新卡片点赞 | 只改 DOM；显示数映射 helpful count | `POST /api/community/posts/:id/reactions` toggle | `PUT/DELETE /api/v1/posts/:id/like`；响应是权威 `likeCount/viewerHasLiked` |
| 旧 helpful/curious | 旧卡片调用真实 reaction | helpful/curious 均落库 | 兼容期 helpful 映射 canonical like；curious 只读保留，不折算点赞 |
| 帖子详情/评论 | community API get/comment/list/delete | 现有详情、评论分页与所有权 | `GET /api/v1/posts/:id`、`GET/POST /posts/:id/comments`；旧路径兼容 |
| 帖子管理/提问 | `communityApi.update/remove/question`（`script.js:1448,1471,1868`） | PATCH/DELETE post、POST questions | v1 revision PATCH/软删/questions；编辑 flag 关闭时解释 EDIT_DISABLED |
| 发布 composer | 旧表单与新 composer 都直接 `POST /api/community/posts`，Base64 媒体（`script.js:3931-3966,4822-4845`） | 创建帖子并同步写本机文件 | 先保存云草稿/媒体，再 `POST /api/v1/drafts/:id/publish` + `Idempotency-Key` |
| 观测记录分享 | 多个入口直接创建社区帖（`script.js:3850-3868,4005-4031`） | 同一旧 POST，可带 observationId | 前端创建带 observationId 的草稿后调用同一 publish；旧 POST 仅作为内部适配器 |
| 地点 | 拼进 body | 无 location 列 | 草稿/帖子使用 `locationText` 独立字段 |
| 草稿 | localStorage，媒体不保存 | 无 | `GET/POST /api/v1/drafts`，`GET/PATCH/DELETE /drafts/:id`，版本冲突检测 |
| 发布后个人页 | 写 `view=personal` 后回推荐；客户端过滤 canManage | 无个人帖子接口 | `GET /api/v1/users/:id/posts` 或 `/me/posts`；personal 路由正常 |
| 消息 | 四条硬编码 | 无 | 通知列表、未读数、单条/全部已读；“清空”映射 read-all |
| profile 初始化 | 两次 status；normalizer 丢字段 | status 返回完整私有 DTO | 一次 `GET /api/v1/me`，完整保留 false/null/empty |
| 保存基本资料/公开开关 | 全量 `PATCH /api/auth/profile` | 实际全量覆盖 | `PATCH /api/v1/me/profile` 稀疏更新基本字段和 `publicProfile`；旧路径调用同一 service |
| 保存“站内提醒” | 同一 profile PATCH 写 emailNotifications | users.email_notifications | `PATCH /api/v1/me/notification-preferences`；邮件与站内分离 |
| 公开资料开关 | 只写 users，其他地方不执行 | 无公开消费 | 公开 DTO/作者投影/feed/media policy 全部执行隐私规则 |
| 注销账号 | `DELETE /api/auth/account` | 硬删 + 部分社区媒体清理 | `DELETE /api/v1/me`；验证、事务状态、全媒体清理任务和审计；旧路径兼容 |
| 观测创建/列表 | `observationApi.create/list`（`script.js:1144,3830`） | `POST/GET /api/observations` | 保留旧路径或 v1 alias；写请求统一 CSRF，删除走 Outbox |
| 服务端识别 | `recognitionRequest`（`script.js:2513-2565`） | `POST /api/recognition/classify` | 保留旧路径或 v1 alias；pre-auth CSRF + CPU limiter |
| 社区图片/视频 | 访问现有 image/video URL | public immutable 文件响应 | 兼容旧 URL；新 media delivery 必须执行 post visibility/moderation policy 或签名 URL |

## 5. 目标架构：模块化单体，不一次性微服务化

目标仍是一个代码库、一个 API 部署单元。**当前生产控制器只允许 PM2 inventory 中存在一个 `birdora-web-auth`，因此不能直接把 Outbox/media-cleanup worker 作为第二进程上线。** V003 前必须二选一并完成故障演练：把 worker 内嵌到同一受控进程且在 pending journal/maintenance 时暂停；或正式扩展为“已知 writer inventory”，要求每个 worker 全生命周期持有相同 DB shared lock、响应 activation journal 停写、参与 drain/PM2 dump/health/PID 验证。未完成前，第二进程会被部署器视为 foreign app，手工绕过则会破坏数据库写屏障。

```text
Browser / static public/
  └─ /api/v1
      ├─ route + auth + CSRF + rate limit
      ├─ schema validation + controller
      ├─ domain services
      │   ├─ auth/profile
      │   ├─ social/follow
      │   ├─ community/feed/like
      │   ├─ draft/publish/moderation
      │   └─ notification
      ├─ repository + transaction boundary
      │   └─ SQLite adapter（MVP）/ PostgreSQL adapter（阶段 5）
      ├─ media port
      │   └─ local disk adapter（MVP）/ object storage adapter（阶段 5）
      └─ outbox worker + SSE hub
```

建议目录边界：

```text
app/
  api/v1/                 routes, controllers, validators, serializers
  domain/                 profile, social, community, drafts, moderation, notifications
  repositories/           user, follow, post, draft, notification
  db/
    migrations/
    sqlite/
    postgres/             阶段 5 才实现
  media/
    local.adapter.js
    object.adapter.js     阶段 5 才实现
  workers/
    outbox.worker.js
    media-cleanup.worker.js
  policies/
    post-visibility.js
    profile-privacy.js
    media-access.js
```

硬边界：

- controller 不直接拼 SQL 或删除文件。
- domain service 定义事务，repository 只做持久化。
- 阶段 1 就定义 Promise-based repository 与 transaction-scoped Unit of Work（例如 `withTransaction(async tx => ...)`）；SQLite adapter 内部可以同步执行，但 domain 不依赖 `DatabaseSync` 返回形态，避免阶段 5 重写事务。
- 所有 feed、详情和媒体读取复用同一 visibility/moderation policy。
- 对象存储、PostgreSQL、SSE fan-out 通过 adapter/port 演进，不提前拆进程间 RPC。
- `node:sqlite DatabaseSync` 可保留至阶段 5；识别和大文件处理需要单独并发闸门，不能阻塞所有请求。

## 6. 目标数据模型

### 6.1 原则

- MVP 不重命名 `community_posts` 等现有表；先做增量扩展，减少停机和兼容风险。
- 所有新枚举在应用校验之外增加数据库 `CHECK`；核心所有权/业务关系使用外键和必要索引。通知快照等明确的多类型引用可以例外，但不能承担权限判断。
- 时间统一 UTC；SQLite 仍存 ISO 8601 TEXT，PostgreSQL 阶段转 `timestamptz`。
- 列表使用 `(sort_time, id)` keyset；不要把 offset 带入新 feed/follow/notification 契约。
- 私有用户 DTO 与公开用户 DTO 从 serializer 层分离，不能先取私有对象再“临时删除几个字段”。
- 计数的权威来源是关系行；MVP 不把可漂移的点赞计数缓存当唯一事实。
- DB 与文件系统不可能形成同一 ACID 事务，媒体通过状态、Outbox 和可重试清理收敛。

### 6.2 表与列

| 对象 | 关键字段/约束 | 用途 |
|---|---|---|
| `schema_migrations` | `version PK, name, checksum, applied_at` | 版本、校验和与重复执行保护 |
| `data_migrations` | `name PK, status, detail_json, completed_at` | 旧 JSON 一次性导入、数据回填完成标记 |
| `users`（扩展） | 现有字段 + `account_status, deletion_requested_at`；`avatar_url` 仅保留兼容期 | 私有资料和逻辑删除状态；email 永不进入公开 DTO |
| `account_deletion_jobs` | `id, user_id NULL ON DELETE SET NULL, user_id_snapshot, mode, status, total_items, completed_items, requested_at, completed_at, last_error` | 202 异步注销的持久进度和恢复入口 |
| `account_deletion_job_items` | `id, job_id FK, media_id NULL, provider, storage_key, expected_hash, status, attempts, completed_at, last_error`；`UNIQUE(job_id,storage_key)` | 每个媒体清理项和 Outbox correlation；全部 terminal 才完成 job |
| `user_follows` | `follower_user_id, followed_user_id, created_at`；复合 PK；`CHECK follower <> followed` | 关注关系；分别为 follower、followed 建游标索引 |
| `community_posts`（扩展） | `location_text, visibility, status, moderation_status, moderation_source, published_at, deleted_at, version` | 帖子生命周期与统一可见性 |
| `community_post_likes` | `post_id, user_id, created_at`；复合 PK | 单一“赞”的权威关系 |
| `post_drafts` | `id, user_id, observation_id, title, body, bird, location_text, visibility, version, consumed_at, created_at, updated_at` | 云草稿与乐观并发 |
| `media_assets` | `id, owner_user_id NULL ON DELETE SET NULL, bound_draft_id, bound_post_id, bound_avatar_user_id, bound_observation_id, sort_order, kind, purpose, provider, storage_key UNIQUE, mime_type, size_bytes, sha256, width, height, duration_ms, status, expires_at, timestamps` | 四个 bound 列都是真实 FK；CHECK 至多一个非空，保证单一归属；avatar user 有 UNIQUE partial index |
| `post_revisions` | `id, post_id, author_user_id, base_version, title, body, location_text, visibility, status(pending/approved/rejected/cancelled_by_safety_change), timestamps`；partial UNIQUE(post_id) WHERE pending | 每帖最多一个待审 revision；公开面继续读最后批准快照 |
| `content_reports` | `id, post_id FK, reporter_user_id FK, reason, detail, status, created_at, handled_at` | MVP 只举报帖子；同用户/帖子/原因去重 |
| `moderation_cases` | `id, post_id FK, revision_id FK, source, status, assigned_user_id, opened_at, closed_at` | 明确审核哪一个 revision；submission/report 队列持久对象 |
| `content_safety_results` | `id, draft_id FK NULL, revision_id FK NULL, media_id FK NULL, rule_set_version, decision, reasons_json, created_at`；CHECK 目标恰有一个 | 自动规则版本、结果和可审计原因 |
| `moderation_actions` | `id, case_id FK, post_id FK, revision_id FK, moderator_user_id FK, from_status, to_status, reason, metadata_json, created_at` | MVP 帖子/revision 审核决定与不可变审计轨迹 |
| `user_roles` | `user_id, role, created_at`；复合 PK | 最小 moderator/admin RBAC |
| `user_role_audit` | `id, target_user_id FK, role, action, actor_user_id NULL, actor_label, reason, created_at` | 首个 moderator bootstrap 与后续角色变更审计 |
| `idempotency_records` | `user_id, scope, key, request_hash, state, status_code, response_json, resource_id, expires_at`；唯一 `(user_id,scope,key)` | 防止重复发布；同 key 不同 body 返回 409 |
| `outbox_events` | `id, event_type, aggregate_type, aggregate_id, payload_json, dedupe_key UNIQUE, attempts, available_at, lock_owner, locked_until, processed_at, dead_lettered_at, last_error, created_at` | 业务事务后的可靠异步工作 |
| `notifications` | `id, recipient_user_id, actor_user_id, type, entity_type, entity_id, payload_json, dedupe_key UNIQUE, read_at, created_at` | 通知列表和未读状态 |
| `notification_preferences` | `user_id PK, in_app_enabled, likes_enabled, comments_enabled, follows_enabled, moderation_enabled, system_enabled, email_enabled, updated_at` | 站内与邮件语义分离 |
| `user_event_stream` | `sequence INTEGER PK AUTOINCREMENT, user_id, event_type, payload_json, created_at, expires_at` | SSE 可重放事件；按 user/sequence 索引 |

公开资料默认只允许 `id/nickname/bio/avatarUrl/publicProfile/counts/viewer relationship`。email、通知偏好、精确年龄和 gender 默认不公开；后两项是否允许用户显式公开，需产品与隐私评审另行确认。

头像在 V003 迁入 media_assets：对现有 Base64 做真实签名/完整解码，写 local media adapter、计算 SHA-256，并将 media 的 `bound_avatar_user_id` 指向用户。该列的唯一索引保证每个用户最多一个活动头像，同一 media 行的跨资源 CHECK 保证不能同时属于草稿和头像。serializer 在兼容期优先用 media asset 派生 URL，失败时回退 `avatar_url`；新头像通过 V003 同批提供的专用 avatar endpoint 原子换绑。`avatar_url` 只有在 V011、回填/坏数据报告归零且回滚窗口结束后才能删除。公开头像仍受 `publicProfile` 和最终头像公开规则约束。

media 的四个 bound FK 均使用 `ON DELETE SET NULL`，使资产行能保留为清理账本；资源删除事务同时把 asset 标记 deleting 并写 Outbox。DB CHECK 保证非空 bound 列数量不超过 1，`status='attached'` 时必须恰有 1 个；draft/post 的 `(bound_id,sort_order)` 建唯一索引。

### 6.3 状态机和统一可见条件

帖子状态：

```text
草稿（post_drafts）
  -> submit
community_posts.status = submitted
moderation_status = pending
  -> 自动规则或人工通过 -> status=published, moderation_status=approved, published_at=now
  -> 拒绝                 -> status=submitted, moderation_status=rejected
  -> 举报/复核             -> moderation_status=under_review（是否自动进入由产品规则决定）
  -> 管理员隐藏            -> moderation_status=hidden
  -> 恢复                  -> moderation_status=approved（仅原发布状态可恢复）
  -> 作者/管理员删除       -> status=deleted, deleted_at=now
```

媒体状态：

```text
temporary -> processing -> ready -> attached
     |           |          |          |
     +-----------+----------+----------+-> quarantined / deleting -> deleted
```

任何 feed、帖子详情、作者公开列表和媒体下载必须调用同一 policy。非作者可见的最低谓词是：

```sql
posts.status = 'published'
AND posts.moderation_status = 'approved'
AND posts.deleted_at IS NULL
AND visibility_allows(posts.visibility, viewer_id, author_id)
```

作者可以查看自己的 submitted/rejected 状态和原因，但不能通过原始媒体 URL 绕过 quarantine。管理员读取必须有角色检查并写审计日志。

帖子编辑采用 revision，不原地覆盖已批准快照：`PATCH /posts/:id` 写 `post_revisions(status=pending,base_version=...)`。每帖只允许一个 pending；存在时返回 `409 PENDING_REVISION_EXISTS`，不静默 supersede。审核期间公众继续看到 `community_posts` 中最后批准版本；批准时事务性复制 revision 到主表并增加 version，拒绝时保留原公开版本并只向作者展示原因。这样回滚/审核不会让原批准内容丢失。全新帖子在首个 revision 通过前没有公开快照。

隐私收紧不能等待审核：public -> followers/private、立即 unpublish、清除 location、删除媒体都直接在事务中生效并写审计/Outbox；同时把现有 pending revision 标记 `cancelled_by_safety_change`，防止之后批准旧 revision 又恢复敏感数据。扩大可见范围、新增地点或正文改动才进入新 revision。MVP 禁止替换已发布帖媒体，用户可删除敏感媒体或创建新帖；未来若支持替换，必须增加 revision-media 模型后再开放。

## 7. 版本化迁移顺序

阶段 0 只做可回滚的代码、契约、前端和部署配置修复，不再向 `ensureColumns` 追加临时 DDL。阶段 1 建立迁移器后，按下表执行。

| 版本 | 迁移内容 | 回填/验证 | 兼容与回滚 |
|---|---|---|---|
| V001 baseline | 空库创建锁定提交的完整权威 schema + `schema_migrations`；现有库先识别已知 fingerprint，必要时事务性重建约束后再 adoption，未知形态直接中止 | fresh/现有两路最终 fingerprint 相同；业务行数/主键不变；`integrity_check`、`foreign_key_check` | 迁移前备份；V001 验收后删除旧运行时 CREATE/ALTER 路径 |
| V002 legacy-retirement | 建 `data_migrations`；旧 users/tokens JSON 只导入一次并标记；移除运行时 legacy 清理，但保留所有已有 legacy 业务表 | 导入前后行数、重复 email/jti、注销复活回归；记录 legacy 表 inventory，断言 V002 前后表和业务行均未丢失 | 禁止自动 DROP；积分业务永久禁用。旧表归档/删除延后到人工确认、独立备份和回滚窗口结束后的后续版本 |
| V003 operational-media | 建 `outbox_events`、`account_deletion_jobs`、dormant `post_drafts` 与具 concrete bound FKs 的 `media_assets`；users 增 `account_status/deletion_requested_at`；提供 avatar upload，先用于头像和 `media.delete_requested` | worker 重跑、失败重试、dead-letter；头像完整解码/像素/重编码/EXIF/hash 与 fallback 报告 | draft API 仍关闭；account deletion 默认关闭至迁移/worker 验收；保留 `avatar_url` 兼容读 |
| V004 social-graph | 建 `user_follows` 与双向索引 | 自关注约束、重复 PUT/DELETE、A/B/C 数据集 | 新接口可关，表不删 |
| V005 post-policy | 为 `community_posts` 增 location/status/moderation/visibility/published/version/deleted 列和索引 | 旧帖先做规则扫描/抽样；只有产品批准 grandfather 才回填 `published/approved/public`，否则 `under_review`；记录 `moderation_source=legacy_backfill` | 旧查询只能走安全兼容 policy；新 feed 开关切换后再停止旧路径 |
| V006 canonical-like | 建 `community_post_likes`；把 reaction_type=helpful 1:1 回填 | helpful 行数、去重数与 like 行数相等；curious 不参与 | 旧 reaction 表不删；旧 helpful endpoint 映射新表 |
| V007 drafts-publish | 建 idempotency records，补 draft publish 索引/约束并激活 media purpose/status；启动 legacy community/observation inventory backfill | inventory/hash/orphan 通过 `data_migrations` 游标分批运行，不占长 DDL 事务 | 旧 image/video 表和 URL 保留；draft/media API 可关 |
| V008 moderation | 建 post revisions、reports、cases、safety results、roles/role audit、moderation actions；为每个 legacy post 回填当前快照 revision | 每帖最多一个 pending；case/action revision FK；report/decision/角色审计链；规则版本；读取 policy | 发布/编辑开关保持关闭即可回退 |
| V009 notifications | 建 notifications、preferences；从 `users.email_notifications` 回填 `email_enabled` 后切 canonical read/write；为 outbox 增通知消费者 | 新旧值逐用户核对；旧 serializer/旧 PATCH 经 adapter 读写 preferences | 保留 users 旧列至 V011；关闭 consumer/前端入口不删历史 |
| V010 event-stream | 建 user_event_stream 与 TTL 索引 | SSE Last-Event-ID、过期 resync、容量清理 | 关闭 SSE 回轮询；不影响通知 REST |
| V011 contract-cleanup | 至少一个明确兼容窗口后再移除旧列/旧表/旧 endpoint | 线上访问日志为零、数据导出归档、恢复演练 | 不属于 MVP；不得与业务上线同批 |

迁移执行规则：

1. 开发/测试可由 `initializeDatabase()` 在 listen 前串行执行；生产部署只允许显式 `pnpm db:migrate` apply，API 启动只验证 schema，误配自动迁移也失败。每次生产 release 都须先独立执行 `pnpm db:backup` 并把验证快照 pin 到本次 bundle，完成后才允许 migration；无 pending 的代码 release 也不例外。
2. 每个迁移文件带不可变校验和；已应用文件被修改时启动失败。
3. SQLite DDL 尽量放在 `BEGIN IMMEDIATE`；不支持安全回滚的表重建必须先备份并做影子表校验。
4. schema migration 只做短 DDL。头像/文件 hash/inventory 等长回填使用 `data_migrations` 保存 cursor、进度和错误，可重跑；回填完成前依赖 feature flag 保持关闭。
5. 备份和迁移前先用持久化 Nginx maintenance flag 阻断整个网站，reload 后等待旧 Nginx worker 退出，再排空 API 连接并停止 PM2；同点归档 community + observations 媒体、配置和 release 审计元数据，然后以独立 `db:backup`/`VACUUM INTO` 生成自包含 DB 快照。快照/manifest pin、checksum 与整个 bundle 校验未完成时禁止 migration。
6. V001 验收后，`database.js` 不再承担运行时 CREATE/ALTER/DROP；空库与旧库都只能由 migration 到达同一 fingerprint。V001/V002 只做兼容扩展和导入标记，不删除线上既有业务表。
7. 对已知 legacy variant 的 FK/trigger 分叉，V001 使用影子表（`*_v001_new`）创建权威约束、复制并核对主键/行数/外键，再原子换名和重建索引/触发器；未知 fingerprint 直接失败，不能只写 adoption 标记。
8. 迁移后执行 `integrity_check`、`foreign_key_check`、关键表行数、外键孤儿和媒体引用核对。
9. 迁移或部署任一步失败时 maintenance flag 保留、不得自动恢复写；候选 PM2 必须停止，已切换的 runtime/static symlink 恢复旧指针，但旧 API 不自动启动。快照 pin 后、migration 前创建持久 journal，并在 migration/postflight 后逐阶段推进；只有公开 API/首页验证成功后才最后写 `activationVerified=true` 的 marker，marker fsync 后再清 journal。任何 journal 残留都拒绝新部署并要求人工 reconciliation。Docker/Compose/PM2 部署检查分别使用 live/ready 的正确语义。
10. 采用 expand -> backfill -> switch -> contract；破坏性 contract 至少延后一版。

## 8. 目标 API 契约

### 8.1 统一包装

新 `/api/v1` 成功响应；`meta` 只在列表/分页响应中出现，单资源和 mutation 不返回空 meta：

```json
{
  "data": {},
  "meta": {
    "nextCursor": null,
    "hasMore": false
  },
  "requestId": "uuid"
}
```

失败响应：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求字段不合法",
    "fieldErrors": {
      "locationText": "最多 160 个字符"
    }
  },
  "code": "VALIDATION_ERROR",
  "message": "请求字段不合法",
  "requestId": "uuid"
}
```

兼容窗口内保留顶层 `code/message/requestId`，旧前端仍可工作；新客户端只依赖 `error`。API 未命中统一返回 JSON `404 API_ROUTE_NOT_FOUND`。

通用语义：

- Cursor 是后端生成并签名的 opaque base64url，内部至少绑定 endpoint/query type、规范化过滤条件、排序值和 id；不能把 recommended cursor 用到 following。签名、过滤或格式不符返回 400。
- `PATCH` 只修改请求中实际出现的字段；`null`、空字符串和省略三者语义在 schema 中分别定义。
- `PUT/DELETE follow` 与 `PUT/DELETE like` 是 desired-state 幂等操作，重试不能翻转状态。
- 发布要求 `Idempotency-Key`；同一用户/作用域/key/请求哈希重放原业务 `data` 和 HTTP status，但使用当前请求的新 requestId；不同请求哈希返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 可变资源返回 `version`；本项目统一在 PATCH JSON body 发送 version，冲突返回 `409 VERSION_CONFLICT`，不同时再实现 If-Match/412。
- 401 表示未登录，403 表示已识别但无权，404 对需要防枚举的私有资源可同时用于不存在/不可见。
- 所有时间为 UTC ISO 8601；前端负责本地化显示。

### 8.2 接口清单

#### Public capabilities

| 方法 | 路径 | 鉴权 | 核心语义 |
|---|---|---|---|
| GET | `/api/v1/capabilities` | 公开 | `Cache-Control:no-store`；返回可公开的功能开关、上传限制和禁用原因，不返回 secret/admin 配置 |

```json
{
  "data": {
    "features": {
      "accountDeletion": false,
      "communityPublish": false,
      "communityPostEdit": false,
      "socialFeedV1": false,
      "notifications": false,
      "sse": false
    },
    "limits": {
      "communityImageBytes": 1048576,
      "communityVideoBytes": 8388608
    },
    "disabledReasons": {
      "communityPublish": "功能仍在安全建设中"
    }
  },
  "requestId": "uuid"
}
```

静态前端用它隐藏/禁用注销、发布、编辑、消息等控件并解释原因；读取失败时高风险写功能默认禁用。服务端仍是唯一权威，不能因前端按钮隐藏而省略路由检查。`COMMUNITY_DEMO_ENABLED` 是本地/测试前端配置，生产构建恒为 false；`sort(() => Math.random()-0.5)` 在阶段 0 直接删除，不能靠 demo flag 间接控制。

#### 当前用户与公开资料

| 方法 | 路径 | 鉴权 | 核心语义 |
|---|---|---|---|
| GET | `/api/v1/auth/csrf` | 可匿名/会话绑定 | 取得短时 signed CSRF token；登录后旋转 |
| POST | `/api/v1/auth/register` | pre-auth CSRF + auth limiter | 注册并写 HttpOnly Cookie；协议版本仍属后续 |
| POST | `/api/v1/auth/login` | pre-auth CSRF + auth limiter | 登录、旋转 JWT/CSRF |
| POST | `/api/v1/auth/logout` | session 或 pre-auth CSRF | 始终由服务端清 auth/CSRF HttpOnly Cookie；仅 JWT/jti 可验证时写撤销记录；幂等返回 |
| GET | `/api/v1/auth/session` | 可匿名 | 始终 200 + no-store，返回精确定义的 navigation session DTO，用于导航/匿名社区 |
| GET | `/api/v1/me` | 必须 | 完整私有用户 DTO，不使用公开 serializer |
| PATCH | `/api/v1/me/profile` | 必须 + CSRF | 稀疏更新 nickname/bio/gender/age/publicProfile；头像走专用接口 |
| POST | `/api/v1/me/avatar` | 必须 + CSRF | V003 起可用；multipart、完整安全处理、原子替换头像 asset |
| DELETE | `/api/v1/me/avatar` | 必须 + CSRF | 立即清绑定，旧 asset 进入 deleting/Outbox |
| PATCH | `/api/v1/me/notification-preferences` | 必须 + CSRF | 邮件、站内和各通知类型分离 |
| DELETE | `/api/v1/me` | 必须 + CSRF + 当前密码 | 返回 202，标记 account deleting、清 Cookie 并创建持久 deletion job；最终硬删/匿名化按产品决定 |
| GET | `/api/v1/users/:userId` | 可选 | 严格公开 DTO；执行 `publicProfile` |
| GET | `/api/v1/users/:userId/posts` | 可选 | 仅返回 viewer 可见且审核通过的帖子；cursor |
| PUT | `/api/v1/users/:userId/follow` | 必须 + CSRF | 幂等关注；拒绝自关注 |
| DELETE | `/api/v1/users/:userId/follow` | 必须 + CSRF | 幂等取消关注 |
| GET | `/api/v1/users/:userId/followers` | 可选/按隐私 | cursor 粉丝列表 |
| GET | `/api/v1/users/:userId/following` | 可选/按隐私 | cursor 关注列表 |

公开 DTO 至少为：

```json
{
  "id": "uuid",
  "nickname": "观鸟者",
  "bio": "",
  "avatarUrl": "",
  "publicProfile": true,
  "counts": {
    "posts": 0,
    "followers": 0,
    "following": 0
  },
  "viewer": {
    "isSelf": false,
    "isFollowing": false
  }
}
```

email、gender、age、emailNotifications 和内部角色不得出现在该 DTO。

`GET /api/v1/me` 对匿名请求返回正常 401；匿名页面不把它当服务故障，而使用始终 200 的 `/api/v1/auth/session`。profile 页面确认登录后再请求 me。

Session DTO 与完整 profile DTO 必须分离，不能继续共用要求 email 的 `normalizeAuthUser` 或写入同一个 localStorage key：

```json
{
  "data": {
    "authenticated": true,
    "user": {
      "id": "uuid",
      "nickname": "观鸟者",
      "avatarUrl": ""
    }
  },
  "requestId": "uuid"
}
```

匿名时 `authenticated=false,user=null`。导航 session 只保存在页面内存；`/me` 才返回 email、bio、gender、age 和偏好等私有资料。两个响应都设置 `Cache-Control: no-store`。

#### Feed、帖子和点赞

| 方法 | 路径 | 鉴权 | 核心语义 |
|---|---|---|---|
| GET | `/api/v1/feed?type=recommended\|following&cursor=&limit=` | recommended 可选；following 必须 | 统一 policy + keyset；不混 demo，不浏览器随机 |
| GET | `/api/v1/posts/:postId` | 可选 | viewer 可见详情；作者可见审核状态 |
| PATCH | `/api/v1/posts/:postId` | 作者 + CSRF + version | 内容/新增地点创建 pending revision；批准前展示最后批准版本；MVP 不替换媒体 |
| PUT | `/api/v1/posts/:postId/visibility` | 作者 + CSRF + version | 收紧立即生效；扩大范围创建 pending revision |
| POST | `/api/v1/posts/:postId/unpublish` | 作者 + CSRF | 立即从所有公开读移除 |
| DELETE | `/api/v1/posts/:postId/location` | 作者 + CSRF + version | 立即清除敏感地点 |
| DELETE | `/api/v1/posts/:postId/media/:mediaId` | 作者 + CSRF + version | 立即解绑/隐藏媒体并写清理 Outbox；MVP 不替换 |
| DELETE | `/api/v1/posts/:postId` | 作者/管理员 + CSRF | 软删除 + Outbox 清理 |
| PUT | `/api/v1/posts/:postId/like` | 必须 + CSRF | 幂等点赞，返回权威计数 |
| DELETE | `/api/v1/posts/:postId/like` | 必须 + CSRF | 幂等取消点赞 |
| GET/POST | `/api/v1/posts/:postId/comments` | GET 可选；POST 必须 + CSRF | 保留现有评论能力并统一 cursor/错误 |
| DELETE | `/api/v1/posts/:postId/comments/:commentId` | 评论作者 + CSRF | 保留当前所有权；是否允许帖子作者 moderation 另确认 |
| GET/POST | `/api/v1/posts/:postId/questions` | GET 可选；POST 必须 + CSRF | 兼容现有 open questions；状态流转扩展不在本轮 |
| POST | `/api/v1/posts/:postId/reports` | 必须 + CSRF | 原因枚举、详情长度、去重和限流 |

推荐 feed 的 MVP 定义为“确定性的公开发现流”：只取 eligible posts，按 `published_at DESC, id DESC`。它不是个性化推荐，不使用浏览器随机。following 只返回已关注作者的 public/followers 内容；零关注时返回真实空态，不回退混入推荐帖。是否包含自己的帖子列为产品确认项。

Post item 至少包含：

```json
{
  "id": "uuid",
  "author": {
    "id": "uuid",
    "nickname": "观鸟者",
    "avatarUrl": ""
  },
  "title": "清晨观察",
  "body": "正文",
  "locationText": "杭州·某公园",
  "visibility": "public",
  "media": [],
  "likeCount": 12,
  "viewerHasLiked": false,
  "commentCount": 3,
  "createdAt": "2026-07-11T00:00:00.000Z",
  "publishedAt": "2026-07-11T00:00:00.000Z",
  "version": 1
}
```

Like 响应只需返回局部权威状态，避免每次传完整 post：

```json
{
  "data": {
    "postId": "uuid",
    "likeCount": 13,
    "viewerHasLiked": true
  },
  "requestId": "uuid"
}
```

#### 草稿、媒体和发布

| 方法 | 路径 | 鉴权 | 核心语义 |
|---|---|---|---|
| GET/POST | `/api/v1/drafts` | GET 必须；POST 必须 + CSRF | cursor 列表 / 新建空或带 observationId 草稿 |
| GET | `/api/v1/drafts/:draftId` | owner | 完整草稿 |
| PATCH | `/api/v1/drafts/:draftId` | owner + CSRF + version | 稀疏更新；冲突 409 |
| DELETE | `/api/v1/drafts/:draftId` | owner + CSRF | 删除草稿，临时媒体进入清理 |
| POST | `/api/v1/media` | 必须 + CSRF | MVP multipart 上传，返回 owner 绑定的 `mediaId/status` |
| GET | `/api/v1/media/:mediaId/content` | 会话可选，按 media policy | V003 先支持头像并执行 profile privacy；V007 扩到 draft/post；不暴露 storage key |
| DELETE | `/api/v1/media/:mediaId` | owner + CSRF | 仅未发布/临时资产可删 |
| POST | `/api/v1/drafts/:draftId/publish` | owner + CSRF + Idempotency-Key | 发布事务；可能返回 submitted/pending |

发布请求不信任客户端提供的 owner、author、likeCount、moderationStatus 或 media URL。草稿字段包含 title/body/locationText/visibility/observationId/mediaIds/version。

#### 观测与识别的保留路径

这两个领域不是本轮重构重点，但其去向必须明确。阶段 1 可先保留现有 `/api/observations`、`/api/recognition/classify`；若加入 v1 alias，则只统一包装/验证/repository，不顺带扩张产品范围：

| 方法 | 目标/兼容路径 | 鉴权 | 本轮行为 |
|---|---|---|---|
| POST/GET | `/api/v1/observations` | 必须；POST + CSRF | 保留创建/本人列表；新列表可逐步 cursor |
| GET | `/api/v1/observations/:id` | owner | 保留私有详情 |
| GET | `/api/v1/observations/:id/media` | owner | 通过 media policy；旧 `/:id/image` 兼容 |
| DELETE | `/api/v1/observations/:id` | owner + CSRF | 关联帖子冲突仍 409；删除走 Outbox |
| POST | `/api/v1/recognition/classify` | 公开 + pre-auth CSRF/严格 limiter | 兼容同步 JPEG classify；任务化识别另立项 |

如果本轮不创建这些 v1 alias，现有路径必须继续工作并使用阶段 1 的稳定错误、限流、日志和媒体清理基线。

#### 审核管理

| 方法 | 路径 | 鉴权 | 核心语义 |
|---|---|---|---|
| GET | `/api/v1/admin/moderation/cases` | moderator | 按 pending/reported cursor 查询 |
| GET | `/api/v1/admin/moderation/cases/:id` | moderator | 内容、媒体安全结果、举报摘要 |
| PUT | `/api/v1/admin/moderation/cases/:id/decision` | moderator + CSRF | approve/reject/hide/restore；必须 reason；写不可变 action |

没有最小 moderator 角色、队列/查询、决定接口和审计日志时，不能把生产发布开关置为 true。

#### 通知与实时

| 方法 | 路径 | 鉴权 | 核心语义 |
|---|---|---|---|
| GET | `/api/v1/notifications?cursor=&limit=&unreadOnly=` | 必须 | 通知列表；稳定实体快照 |
| GET | `/api/v1/notifications/unread-count` | 必须 | 权威未读数 |
| PUT | `/api/v1/notifications/:id/read` | recipient + CSRF | 幂等单条已读 |
| PUT | `/api/v1/notifications/read-all` | 必须 + CSRF | 幂等全部已读；不删除历史 |
| GET | `/api/v1/events` | Cookie 会话 + Origin | SSE；Last-Event-ID 重放；仅轻量事件 |

MVP 不提供 DELETE notification。“清空”按钮调用 read-all；真正删除、保留期和合规审计另行确认。

### 8.3 旧 API 兼容策略

- `/api/auth/*`、`/api/community/posts/*`、现有 observations/recognition 路径在兼容窗口继续存在。
- 旧 `PATCH /api/auth/profile` 改调用新稀疏 profile service，但保持旧成功体。
- V003 后旧 profile 的 `avatarUrl` adapter 必须识别三种语义：当前派生 URL=不变；新 data URL=验证/重编码后原子换绑 media；空字符串=清头像并让旧 asset 进入 deleting。serializer 同步返回新派生 URL，不能只改 users 旧列而被 media 优先读遮住。
- 阶段 3 门槛前，生产旧 `POST /api/community/posts` 统一返回 `503 PUBLISH_DISABLED`；不能提前声称会创建尚不存在的临时草稿。门槛通过后，它才可创建“临时草稿”并调用同一 publish service、内容安全、媒体所有权与 Outbox 事务。
- V008 前，生产旧 `PATCH /api/community/posts/:id` 统一返回 `503 EDIT_DISABLED`；V008 后兼容 adapter 只能创建 pending revision，不能原地覆盖批准快照。
- 旧 list/detail 响应继续派生 `feedback.helpful`，其数据来自 canonical like；`feedback.curious` 来自冻结的 legacy reactions。
- V009 切换后，`notification_preferences.email_enabled` 是权威；旧 `emailNotifications` serializer 和旧 profile PATCH 都通过 adapter 读写该表，不再双写 users 列。
- 响应增加 `Deprecation`/`Sunset` header 和服务日志计数；默认建议至少保留两个部署窗口，最终期限由产品确认。
- 兼容层只做参数/响应转换，不复制业务规则。

## 9. reactions -> 单一“赞”的兼容与迁移决策

本路线选择 **单一 like 为新 UI 和新 API 的 canonical 语义**：

1. V006 将所有 `reaction_type='helpful'` 行按 `(post_id,user_id,created_at)` 回填到 `community_post_likes`。
2. `curious` 不折算成 like，避免虚增点赞；其历史行保留为只读 legacy 数据。
3. 兼容期旧 `POST /reactions {reactionType:'helpful'}` 仍可 toggle，但内部调用 canonical like service，旧 `feedback.helpful` 从 like 表派生。
4. 冻结 curious 写入前，必须把所有现存 surface 的 curious 控件移除或改只读，包括 `community-post-card.js` 驱动的首页/旧 feed；浏览器 E2E 不再触发 curious POST。
5. 旧 curious 写入随后冻结；如果必须维持旧客户端，可短暂只允许读取并返回明确 deprecated 标识。
6. 所有新 UI 改用幂等 PUT/DELETE，不再用 toggle；阶段 0 的临时 helpful 按钮在请求期间禁用，避免双击把 toggle 再翻回去。
7. 新前端切换完成、旧路径流量归零并完成数据核对后，才进入 V011 contract；历史 curious 是否展示或归档由产品确认。

点赞计数 MVP 每次从关系表聚合或批量子查询得到。若阶段 5 为性能增加 `like_count` 缓存列，必须和关系写入同事务，并提供定期 reconcile；缓存永远不是唯一事实。

## 10. 鉴权、CSRF、限流与输入/媒体安全

### 10.1 现有安全能力应保留

- HttpOnly JWT Cookie、生产 Secure、SameSite=Lax。
- 强 JWT secret 的 production-like fail-fast。
- 精确 CORS allowlist、Origin/Referer 写保护。
- token revocation、requestId、生产 5xx 泛化。
- 参数化 SQL、服务端随机文件名、路径边界检查、基础 magic bytes。
- 关闭 `x-powered-by`，敏感日志基础脱敏。

### 10.2 阶段 1 必补

**JWT 与会话**

- `jwt.verify` 固定 `algorithms:['HS256']`，增加 issuer/audience；生产 secret 继续要求 >=32 随机字符。
- Cookie 继续 HttpOnly/Secure/SameSite=Lax；登录、注销和权限变化后旋转 token/CSRF token。
- 浏览器不得把 JWT、session user、private profile 或 avatar 写 localStorage；导航/session/profile DTO 只放页面内存，Cookie 仍是事实源。与设备状态、未迁云草稿等非身份业务 key 分开审计。
- Bearer 机器客户端与浏览器 Cookie 认证分开定义。现有 Origin Guard 对无 Origin 的 Bearer CLI 也会拒绝，不能通过宽松绕过来“兼容”。

**CSRF**

- 当前精确 Origin Guard + SameSite=Lax 已是有效基础防线；新增 token 是 defense-in-depth，用来覆盖代理剥离来源头、未来跨源部署和错误配置风险，不替代 XSS 防护。
- 在无服务端 session 表的 JWT 架构中使用短时 signed token：`/auth/csrf` 返回带 `scope, nonce, iat, exp` 的 HMAC token；已登录 token 额外绑定 JWT `jti`，签名使用独立 `CSRF_SECRET`。
- register/login 使用 pre-auth scope；登录成功后旧 token 失效，客户端按新 JWT 重新取得 session scope。注销/换 JWT 后同样旋转。
- logout 在 JWT 缺失/过期时接受有效 pre-auth token，并始终发过期 `Set-Cookie` 清 auth/CSRF Cookie；客户端 JavaScript 无法自行删除 HttpOnly Cookie。只有可验证 jti 才写 revoked_tokens。
- 保留 Origin Guard；所有 Cookie 鉴权的非安全方法同时要求 `X-CSRF-Token`。token 只保存在页面内存，不放 URL/localStorage/日志。
- 上线顺序固定为：后端先提供 token 并 report-only 记录缺失 -> 前端统一 client 全量发送 -> 指标归零后 `CSRF_ENFORCEMENT=enforce`。enforce 后旧 `/api/*` Cookie 写路径同样要求 token，不能留绕过口。
- `CSRF_EXPIRED` 必须在业务 handler 前返回；统一 client 最多 refetch/retry 一次。其他 403、网络错误和普通 POST 不自动重试。
- Bearer 认证不使用 CSRF，但走独立客户端策略和 scope；MVP 网站 API 可以暂不开放该策略。
- SSE 虽是 GET，仍校验会话和允许的 Origin，防止跨站读取。

**输入和错误**

- 引入统一 schema validator；在 controller 前完成类型、长度、枚举、数组数量和 unknown fields 策略。
- email、nickname、password 增加上限；不存在用户的登录路径做 dummy password verify，降低时序枚举。
- POST/PATCH body 只接受声明字段；状态/owner/counter 等服务端字段一律拒绝。
- API error code 使用稳定常量，不能再让普通 throw 变成 `code='Error'`。
- 普通 JSON 默认小上限；auth/profile/community legacy/upload 分路由配置。

**限流与资源保护**

- register/login：IP + 规范化账号双维度；profile/delete：user + IP；follow/like/comment/report/publish/media 各自独立桶。
- recognition 增加并发 semaphore、排队上限、请求超时和每 IP/用户额度；不能只依赖 15 分钟计数。
- SSE 限制每用户连接数，并设置最大连接时长和心跳。
- SQLite 单实例阶段可继续内存 limiter；阶段 5 多实例前必须换共享存储。
- 429 返回 `Retry-After` 和稳定错误码。

**安全响应和日志**

- 增加 CSP、HSTS、`X-Content-Type-Options: nosniff`、frame policy 和 Referrer-Policy；Nginx 与 Express 只保留一个明确责任源。
- 日志脱敏扩展到 `data:video`、`videoDataUrl`、`avatarUrl`、CSRF、Cookie、Authorization 和精确地点。
- 结构化日志记录 route template、status、duration、requestId 和匿名 user id，不记录正文、密码或 Base64。

### 10.3 媒体安全

头像会在阶段 2 进入公开 DTO，因此 V003 的 avatar endpoint 必须提前完成下列全部图片安全步骤：JPG/PNG/WebP allowlist、600KiB 输入上限、完整解码、像素上限、去 EXIF/GPS、安全重编码、hash 和配额；不能等阶段 3 通用媒体。其余 MVP 上传同样必须检查：

- 声明 MIME + magic bytes + 完整解码；不能只看扩展名/前缀。
- 原始字节、解码像素、宽高、视频时长和用户总配额。
- 图片剥离 EXIF/GPS；公开媒体不保留设备/作者元数据。
- 服务端生成 storage key；原始文件名仅作为长度受限的展示元数据。
- SHA-256、owner、purpose、status、expiresAt 入 media_assets。
- processing/quarantined 媒体不可下载；私密/followers/审核中媒体不能使用永久 public immutable cache。
- 删除是 `mark deleting + outbox`，worker 成功后标 deleted；文件不存在视为幂等成功。
- 生产阶段增加恶意文件扫描、缩略图和视频转码；这些不是阶段 0 继续 Base64 的前置条件。

## 11. 发布事务、Outbox、通知与媒体清理

### 11.1 发布事务

`POST /api/v1/drafts/:id/publish` 在一个数据库事务内：

1. 锁定/读取 idempotency record；同 key 已完成则原样返回。
2. 校验 draft owner、version、未 consumed、字段长度和 visibility。
3. 校验每个 mediaId 都属于当前用户、状态为 ready/attached-to-this-draft，且未被其他资源使用。
4. 校验 observationId 存在且属于当前用户。
5. 执行基础文本/媒体安全规则；产生规则版本和结果。
6. 创建 post、首个 revision 和 moderation case；默认 `submitted/pending`，只有满足已配置自动通过规则时才在同事务置 `published/approved`。
7. 对每个 media 原子执行 `bound_draft_id -> NULL, bound_post_id -> postId`，单一归属 CHECK 必须通过；标记 attached 并消费草稿。
8. 写 idempotency response 和 Outbox 事件，例如 `post.submitted` 或 `post.published`。
9. COMMIT 后返回 canonical post/status。

任一步失败都回滚帖子、绑定、草稿消费、idempotency 完成态和 Outbox。已写到本机的临时文件保留为 temporary，按 expiresAt 由 worker 清理，不能在错误处理里做不可恢复的猜测性删除。

所有现有发布入口——新 composer、旧发布表单、观测列表分享、识别结果分享——最终必须进入该 service。

### 11.2 Outbox 语义

- 业务事务只承诺“事件已可靠写入数据库”，不在请求内向大量粉丝发通知或删除文件。
- worker 以 at-least-once 消费；`dedupe_key` 和目标表唯一约束使 consumer 幂等。不要声称分布式 exactly-once。
- SQLite claim 使用短事务：`BEGIN IMMEDIATE` -> 选择 `available_at<=now` 且租约为空/过期的事件 -> 原子写 `lock_owner/locked_until` -> COMMIT；实际 I/O 在事务外执行。完成/失败更新必须校验 lock owner，租约过期后可重领。
- `media.delete_requested` payload 必须携带 provider/storage_key/expected hash，不能依赖随后可能被删除的业务行才能找到文件。
- 失败按指数退避更新 attempts/availableAt；超过阈值进入 dead-letter 并告警。consumer 被关闭时监控 backlog 行数/字节、最老事件年龄和磁盘容量；超过批准阈值停止相关写入，而不是无限积压。
- 事件 payload 只保存处理所需快照和稳定 ID，不放 email、token、Base64 或精确敏感地点。
- 首批事件：
  - `media.delete_requested`
  - `user.deleted`
  - `user.followed` / `user.unfollowed`
  - `post.submitted` / `post.published` / `post.moderation_changed`
  - `post.liked` / `post.commented`

### 11.3 通知生成

Outbox worker 根据事件幂等插入 notifications：

- 自己对自己的互动不产生社交通知。
- `dedupe_key` 示例：`post_liked:{postId}:{actorId}:{recipientId}`，反复取消/再赞不刷屏。
- 帖子发布通知只有在 post 真正 `published/approved` 后产生；pending 不进入 feed、也不通知粉丝。
- 删除帖子后通知仍保留必要标题/作者快照，但点击实体返回“内容已不可用”。
- `email_enabled=false` 只阻止未来邮件任务，不阻止必须保留的站内系统/审核通知。
- 未读数直接按 recipient + `read_at IS NULL` 查询；如以后缓存，必须可 reconcile。

### 11.4 注销与删除

阶段 1 的可靠注销顺序：

1. 二次验证和 CSRF。
2. 在一个事务中将 user 置 `account_status=deleting`，创建 job + 每个媒体的 job item，枚举所有社区、观测、头像和临时媒体 storage key；每个 `media.delete_requested` 携带 jobId/itemId，并写必要审计事件。
3. auth middleware 只允许 active 用户；deleting 立即使所有旧 JWT 失去业务访问，响应清 Cookie 并返回 202。
4. worker 幂等删除文件并逐项标记 item；只有 `completed_items=total_items` 且无非 terminal item 后，才执行产品批准的业务硬删/匿名化。媒体资产 owner 可 `SET NULL`，job 因 user FK SET NULL 仍保留清理证据。
5. 失败更新 item/job/Outbox 并重试，不让已经接受的注销请求变成不可追踪半失败；最终删除或匿名化 user 后标 completed。
6. 旧 JSON import 已有完成标记，不能复活账号。

举报、审核审计和必要安全日志是否在注销后保留、保留多久，需要法律/产品确认。

## 12. 实时策略边界

| 能力 | MVP 首选 | SSE 阶段 | WebSocket |
|---|---|---|---|
| 发帖、点赞、关注 | mutation 响应即权威；失败回滚 UI | 只推轻量 invalidation，不传完整 feed | 不需要 |
| 推荐/关注 feed | 首次 REST；页面可见时约 30 秒条件轮询，focus 时刷新；隐藏/离线暂停 | 可选 `feed.invalidated` 后再拉 REST | 不需要 |
| 未读数 | 首次 REST；SSE 未启用或断线时约 60 秒轮询 | `notification.created`、`unread_count.changed` | 不需要 |
| 通知列表 | REST cursor；收到事件后增量刷新 | 事件只带 notificationId/unreadCount | 不需要 |
| 未来聊天/在线状态/协同编辑 | 不在范围 | 单向 SSE 不适合 | 只有立项后才评估 |

SSE `GET /api/v1/events` 约定：

```text
id: <user_event_stream.sequence>
event: notification.created
data: {"notificationId":"...","unreadCount":3}

id: <sequence>
event: unread_count.changed
data: {"unreadCount":0}
```

- EventSource 使用 HttpOnly Cookie，不在 query 放 token。
- 服务端读取 `Last-Event-ID`，从 user_event_stream 重放；超过保留期时发送 `resync.required`，客户端回到 REST。
- 每 15-25 秒心跳，断线指数退避；事件数据最小化。
- Nginx 为该 location 设置 `proxy_buffering off`、合适的 `proxy_read_timeout`、禁缓存，并保留连接头。
- SSE 不作为唯一事实源；轮询和页面 focus refresh 始终是恢复路径。
- 单实例 SQLite 阶段可由同进程 hub 唤醒连接，但可重放记录必须在 DB；阶段 5 多实例再用 PostgreSQL LISTEN/NOTIFY 或共享消息总线 fan-out。

## 13. SQLite -> PostgreSQL 与本机媒体 -> 对象存储

### 13.1 迁移触发条件

不是“表变多就迁移”。出现以下任一持续信号才进入阶段 5 切换：

- 需要两个以上 API 实例或滚动发布零停机。
- 持续出现 `SQLITE_BUSY`、写队列或 P95/P99 写延迟超目标。
- 单机备份 RPO/RTO 无法满足业务要求。
- 通知 fan-out、审核后台或分析查询明显争抢写锁。
- 需要托管高可用、只读副本或更严格的数据权限审计。

### 13.2 迁移前置

- domain 不直接使用 SQLite SQL；repository/transaction adapter 隔离方言。
- 新 API 已使用 keyset、稳定 UUID、UTC 和显式约束，不依赖 ROWID 业务语义。
- migration 在 SQLite/PostgreSQL 两种方言有 schema contract 测试。
- media 表只存 provider/storage_key/hash/metadata，URL 由 adapter 生成。

### 13.3 对象存储迁移

建议先于或独立于 PostgreSQL：

1. local adapter 下先建立完整 media_assets/inventory/hash。
2. 将现有文件做首轮全量复制，逐个校验 size + SHA-256；读取仍走 local。
3. local 仍接受新写期间反复按 inventory cursor 做增量扫描/复制，直到 delta 很小。
4. 开启短维护写屏障，完成最终 delta 和 hash 核对，再切“object 新写 + object 优先/local fallback”读；否则 fallback 永远无法归零。
5. 上传完成前状态 temporary/processing，不允许绑定。public + approved 媒体可 CDN；private/followers/pending 使用短期签名或 API 授权代理。
6. 经过观察保留期、备份和回滚演练，且 fallback 命中率持续为零后，才清理 local 副本。

回滚时切回 local 读/写 adapter；已经只存在 object 的新文件必须先回复制，不能只回滚代码。

### 13.4 PostgreSQL 数据切换

MVP 规模优先选择“短暂只读窗口”，不要首轮实现脆弱双写：

1. 在 staging 完成 SQLite -> PostgreSQL 全量导入演练。
2. 生产进入 maintenance/read-only，`wal_checkpoint` 并备份 DB/媒体。
3. 导入 PostgreSQL；校验各表行数、外键、关键聚合、抽样 DTO 和媒体引用。
4. 切 `DATABASE_URL`，运行 migration/readiness/smoke，再恢复写。
5. 保留只读 SQLite 快照和切换时间点。

只有在 PostgreSQL 接受新写之前，才可以无损切回 SQLite。恢复写之后若要回退，必须先停止写并做反向增量导出；没有反向同步时不得宣称“一键回滚”。迁移验收窗口、RPO/RTO 和最大只读时长要在阶段 5 前由产品/运维确认。

阶段 5 多实例后才引入共享 rate-limit、SSE fan-out 和可选缓存。仍保持模块化单体，不因换数据库自动拆微服务。

## 14. 分阶段里程碑、测试与验收

### 阶段 0：修复 v1.7.0 对接错配

**目标：** 先阻止资料覆盖、隐私反转、假关注/假消息/假点赞和线上媒体 413；不增加新的业务域表。

实现项：

1. 先补 v1.7 characterization/contract tests，再改代码：
   - profile 新字段、`false/null/empty` 往返。
   - profile 稀疏 PATCH。
   - account 注销及 community + observation 文件。
   - MP4/WebM 上传与读取。
2. 拆分 private user 内存归一化与 session/navigation DTO；清理旧 auth localStorage，不持久化 avatar/email/bio/age/偏好；再修资料/偏好稀疏保存和后端 partial PATCH。
3. “站内提醒”控件先隐藏/禁用，并标明“邮件通知偏好（发送尚未开放）”；阶段 4 前不伪装站内或邮件投递能力。
4. 统一图片 1 MiB、视频 8 MiB 的兼容上限；Nginx、路由 parser、前端和测试使用同源配置。
5. 地点仍走旧接口期间做合并长度校验；不静默截断。
6. 先锁定 active auth/navigation/escape smoke，再删除 `script.js` 重复的 auth/render/message/escape 声明；修 personal allowlist/render，合并社区双 list 和 profile 双 status 请求。
7. `COMMUNITY_DEMO_ENABLED=false` 为生产默认；生产不混 demo、不随机排序，following/messages 未实现时显示真实空态。
8. `COMMUNITY_LEGACY_LIKE_ENABLED=true` 仅作为阶段 0 兼容；新“赞”只对真实帖调用旧 helpful API，请求期间禁用按钮，并完全以服务端返回重绘。
9. 增加 `ACCOUNT_DELETION_ENABLED=false` 生产默认值；先补齐 observation 文件 inventory 和待失败测试。V003/worker 验收前不承诺生产注销可恢复。
10. 引入 `COMMUNITY_PUBLISH_ENABLED`。生产正式发布在阶段 3 安全门槛前默认关闭；若需要保留原型直发，只能用显式 legacy/dev 开关并清楚标注非正式能力。
11. 引入 `COMMUNITY_POST_EDIT_ENABLED=false` 生产默认值；旧 PATCH 在 V008 前返回 `EDIT_DISABLED`，dev 回归必须显式开启。
12. 提供最小 `/api/v1/capabilities`（必要时阶段0加旧 alias），前端启动先加载；加载失败时注销/发布/编辑默认禁用并显示原因。直接删除 workspace 的 random sort。

测试/验收：

- 后端返回 bio/avatar/publicProfile=false/emailNotifications=false 后，页面显示准确；刷新仍准确。
- 只改 nickname 不改变 bio/gender/age/avatar/两个偏好；只改偏好不改变资料。
- localStorage 不包含 email、bio、gender、age、avatarUrl、publicProfile、notification preferences 或完整 user JSON；旧 auth keys 会被清理。
- 图片 `1 MiB + 1 byte` 被前后端一致拒绝；8 MiB 视频能穿过实际 Nginx 到 Express，`8 MiB + 1 byte` 被一致拒绝；错误为 JSON。
- MP4、WebM 正常读取，错误签名被拒绝。
- 600 字正文 + 地点在客户端给出明确校验，不发必失败请求。
- 显式开启 legacy/dev publish/edit flag 的 E2E 中，发布后进入 personal且视频帖编辑分析正确；默认生产 flag 下，四个直发入口收到 `PUBLISH_DISABLED`、旧帖子 PATCH 收到 `EDIT_DISABLED`。社区首屏只有一个 feed 请求，profile 只有一个 me/status 请求。
- API 失败不显示 demo 冒充真实数据；following/messages 不展示伪造内容。
- capabilities 正常和失败两种情况下，account/publish/edit 控件都与服务端一致；读取失败不会留下可点击高风险入口。
- 新点赞刷新后仍保留服务端状态，快速双击/请求失败不会产生 DOM 漂移。
- 生产默认关闭 account deletion，调用得到稳定 `FEATURE_DISABLED`；显式测试环境下可复现旧路径 inventory。可靠“全部清除或进入持久重试”移至阶段 1 V003 验收。

退出门槛：上述回归全部自动化通过，锁定提交上的 v1.7 风险不再依赖人工点击判断。

回滚：均为代码/配置修复；保留旧 endpoint。`COMMUNITY_PUBLISH_ENABLED`、`COMMUNITY_POST_EDIT_ENABLED`、`COMMUNITY_DEMO_ENABLED`、`COMMUNITY_LEGACY_LIKE_ENABLED` 独立控制，默认值见第 16 节；不做 schema DROP。

### 阶段 1：稳定后端基线

**目标：** 让后续业务建立在可迁移、可恢复、可测试的单体之上。

实现项：

**1a：迁移、测试和 readiness**

1. 建 V001-V002 migration bootstrap、checksum、旧库 fingerprint adoption、一次性 legacy import 标记、只读 preflight、带自动 SQLite 快照门禁的生产 migrate 命令，以及可独立执行的 backup-only 命令；PM2 每次 release 都在 migration 前独立 backup 并 pin。移除运行时积分清理，但 V002 保留旧表，不自动 DROP。
2. 显式 migration 完成且启动时目标 schema 验证成功后才 listen；生产发现 pending 必须退出，误配 `DATABASE_AUTO_MIGRATE=true` 也拒绝普通 server。PM2 部署先拆分 immutable live/candidate release，使依赖安装与测试不触碰 live cwd；再使用 `flock`、持久化全站 Nginx maintenance、旧 worker/API drain、空库/verified marker 防误建、loopback 3003、runtime/PM2 cwd 与静态 symlink 原子切换、activation-pending journal，并在公开验证后最后写 marker、随后清 journal。Compose 保留显式 one-shot migration。新增 `/api/health/live`、`/api/health/ready`，旧 `/api/health` 在兼容期返回 readiness。
3. 测试脚本统一为：随机端口、临时 SQLite、临时上传目录、自启动服务、完整 teardown。
4. 增加默认 `pnpm test` 与 CI 门禁；报告记录 Git SHA、Node 版本、migration version 和限额配置。
5. 审查现有 signed immutable A/B 控制代码并完成 legacy adoption 方案，再在目标 Ubuntu 实际演练 maintenance/backup/forward-fix recovery runbook；校验 Bash、Nginx、PM2、`flock`、`/proc` 锁身份、旧 worker drain、`ss`、防火墙、目录权限、secret、空库保护、旧签名事实、媒体 bundle、DB pin、runtime/static 原子切换、activation journal 与 verified marker，并在关键边界做断电/SIGKILL 故障注入。截至 2026-07-12，legacy adoption 与目标机演练是两个独立生产阻断项。

**1b：安全、Outbox 与媒体基线**

6. 统一 v1 response/error、JSON 404、schema validation 和 route-specific body limit。
7. 固定 JWT algorithm/issuer/audience；上线 signed CSRF token；细分 limiter；补安全 headers 和日志脱敏。
8. 合并浏览器请求层：auth/community/observation/recognition 共用 CSRF 获取、内存 token、登录/注销旋转、401 处理；`CSRF_EXPIRED` 只允许在中间件未进入业务时单次刷新重试。
9. 按“先 token endpoint/report-only -> 再部署前端 -> 最后 enforce”上线；enforce 后旧 Cookie 写路径也必须带 token。
10. 执行 V003，建 Outbox/租约 worker、media assets、account deletion jobs 和 dormant drafts；先处理媒体删除。
11. 分批迁移头像 Base64，提供 avatar-purpose 受限上传和执行 profile privacy 的读取 URL；生成 community/observation inventory/orphan report，所有长回填走 data_migrations。
12. 把 controller/service 中直接文件删除改为状态 + event；失败可重试和告警。V003 全部验收后才把 `ACCOUNT_DELETION_ENABLED` 置 true。

测试/验收：

- fresh DB、从锁定提交旧库升级、重复执行、迁移中断、checksum 被改、磁盘只读均有测试。
- 迁移失败 API 不监听；DB 不可用时 ready 失败而 live 正常。
- 现网 PM2 或 `current-release.json` 存在时缺失/空数据库必失败；`ALLOW_EMPTY_DATABASE_INITIALIZATION=true` 只在无任何现网 marker 的批准首装生效。生产 server 的 `DATABASE_AUTO_MIGRATE=true` 误配也不得执行 DDL。
- live PM2 cwd 与 candidate `APP_DIR` 相同就必须在候选依赖验证前失败；release A/B 隔离时，在 B 预先安装/测试不改变 A 的源码、依赖、权限或 cwd，maintenance 内原子切换后新 PID cwd 精确落在 B。
- 旧 3003 wildcard listener 未封外网时部署失败；新服务只有 `127.0.0.1:3003`。全站 maintenance 在 preflight、bundle、backup/pin、migration、ready、runtime/static 切换或公网检查故障后持续返回 503；候选停止、两个指针恢复、旧 API 不自动启动。
- legacy adoption 在旧版本证据缺失/错误时失败且不猜 `HEAD^`；无 pending 的更新也在 migration 前独立生成并 pin SQLite 快照。bundle 同时含 community + observations 媒体证据和旧 release 审计元数据。快照 pin 后、migration 开始前原子创建并 fsync activation journal，migration/postflight 后逐阶段推进；断电/SIGKILL 后残留 journal 会保持 maintenance、拒绝新部署，直至人工 reconciliation。runtime/static release 原子切换，`activationVerified=true` marker 最后写入并 fsync，随后才清 journal。
- legacy JSON 只导入一次；注销用户重启后不会复活；V002 前后 legacy 表及其业务行保持不变，且业务代码搜索无新积分字段。任何 DROP 必须是回滚窗口后的独立人工审批版本。
- 所有 API 404/validation/auth/rate-limit/500 均是稳定 JSON + requestId。
- 缺 Origin、错误 CSRF、跨站 Origin、过期 JWT、错误 algorithm、超限请求都被拒绝。
- register/login/logout/community/observation/recognition 的新旧写路径均带正确 token；CSRF_EXPIRED 单次重试不产生重复业务写，report-only 流量归零后才 enforce。
- 媒体删除 worker 在进程崩溃、文件已不存在、权限失败后可重试且最终收敛。
- 头像 Base64 回填后公开/私有规则、格式、hash 和 fallback 正确；坏头像进入可审计报告，不阻断整批迁移。
- V003 后，新 avatar endpoint 与旧 `avatarUrl` 前端都能换头像/清头像；serializer 立即返回新图，旧 asset 最终清理；安全 forward-fix runtime 仍能读取派生 URL。
- 注销返回 202 后所有旧 JWT 不再访问业务；worker 中断/重启可从 account deletion job 继续并最终清理两类媒体。
- 备份恢复后 auth、帖子、观测及两类媒体抽样一致。

退出门槛：schema 版本、readiness、备份恢复、错误契约和安全基线成为部署门禁；immutable runtime release/cwd 切换、activation journal 恢复与目标 Ubuntu 故障注入全部通过，不能只完成其中一项。

恢复：只允许关闭 feature flag 或发布经 schema 兼容审查的 forward-fix；新增表/列保留。恢复数据库前必须全站停写并使用同时间点媒体快照，且恢复后不得启动旧 `896c453`。V001-V003 不包含业务列删除。

### 阶段 2：公开资料、关注、Feed 与权威点赞

**目标：** 用真实社交关系替换 following/demo，用 canonical like 替换 DOM/双语义错配。

实现项：

1. 执行 V004-V006：follows、post policy/location、canonical likes。
2. 建私有/公开 user serializers 和 profile privacy policy；帖子响应增加 author.id/avatar。
3. 实现公开资料、关注/取消、followers/following cursor 列表。
4. 实现 recommended/following feed；所有查询复用 post visibility/moderation policy。
5. helpful -> like 回填和兼容 adapter；所有页面改 PUT/DELETE like，移除/只读化旧 curious 控件并更新 E2E。
6. personal 页改服务端用户帖子列表；删除阶段 0 仅为 dev/feature flag 保留的 demo/random 兼容代码，正式切换 v1 feed。
7. 为 feed/author/like 增 OpenAPI/contract fixtures。

测试/验收：

- A 关注 B、不关注 C：following 只出现 B 的 eligible posts；取消后消失；空关注返回空态。
- 自关注失败；重复 PUT/DELETE 都成功且最终状态正确；并发 follow 不产生重复行。
- `publicProfile=false` 的公开字段、作者卡片和列表严格符合最终产品规则；email 永不泄漏。
- public/followers/private × anonymous/follower/non-follower/author/moderator 形成权限矩阵；帖子与媒体结果一致。
- recommended 顺序确定；在翻页期间插入新帖，cursor 不重复、不跳过既有窗口。
- 并发/重试点赞只有一行；刷新计数与 viewerHasLiked 正确。
- helpful 回填数与去重后 like 数一致；curious 不计入 like；旧 `feedback.helpful` 与新计数一致。
- 首页、旧 feed、新 workspace 均没有可写 curious 控件；全仓浏览器 E2E 不再提交 curious。
- Feed 查询在目标数据量下达到阶段性 P95，且没有 N+1 author/reaction 查询。

退出门槛：生产 following、recommended、personal 和点赞均只依赖服务端事实。

恢复：`SOCIAL_FEED_V1` 可关闭并回安全兼容 list。V006 一旦切换，canonical like 始终是新旧响应的读源；`CANONICAL_LIKE_V1` 只控制新 endpoint/UI，不能切回旧 reaction 读而丢失新赞。forward-fix runtime 必须继续从 like 表派生旧 feedback；不得为兼容目的启动更早服务端。V004-V006 不做 schema 收缩。

### 阶段 3：云草稿、发布事务、举报/审核与内容安全

**目标：** 在正式启用发布前完成媒体所有权、原子发布、可见性和最小审核闭环。

实现项：

1. 执行 V007-V008；实现 media local adapter、multipart、draft CRUD/version/过期。
2. 新 composer 输入停止约 1.5 秒后自动保存云草稿，并按 version 处理多端冲突；离线写队列是后续增强，不作为本阶段门槛。
3. 实现 publish service、Idempotency-Key、locationText、observation 所有权和 media 绑定事务。
4. 旧四个发布入口全部改到同一 service；不得保留绕过审核的 controller。
5. 实现 basic content safety：
   - plain text/Unicode/控制字符/重复垃圾与 URL 规则。
   - 媒体完整解码、像素/时长/配额、EXIF/GPS 清理和 quarantine。
   - 发布/媒体/举报独立限流。
6. 实现 report、moderator queue/decision、roles 和不可变 moderation action；提供仅运维本机可用的 `scripts/admin-role.js grant-moderator --user ... --reason ...`，首个角色也写 user_role_audit。
7. 帖子编辑写 post revision、重新审核并保留最后批准快照；feed/detail/media 全部执行状态、审核和 visibility。
8. 过期草稿/临时媒体、删帖和注销统一走 Outbox cleanup。

**发布启用硬门槛：**

- [ ] V005、V007、V008 全部应用且校验通过。
- [ ] `status/moderation_status/visibility` 有 DB 默认和 CHECK。
- [ ] report endpoint、moderator 队列/决定和审计可用；至少一个受控 moderator 账号。
- [ ] moderator bootstrap CLI/runbook 在临时库和 staging 演练，角色授予/撤销均有审计。
- [ ] basic text/media safety 和 quarantine 可用。
- [ ] 所有 feed/detail/media policy 矩阵通过。
- [ ] 所有发布入口的代码路径测试证明进入同一 service。
- [ ] 所有编辑入口只创建 pending revision，旧 PATCH 不能原地覆盖批准内容。
- [ ] publish idempotency、Outbox、备份和告警通过故障演练。
- [ ] 前端能展示“审核中/已通过/未通过”，不会把 submitted 说成所有人已可见。

任一项未满足时，`COMMUNITY_PUBLISH_ENABLED` 继续为 false。质量文案分析 `analysis_score` 不是内容安全审核，不能用于勾选此门槛。

测试/验收：

- 草稿跨刷新、跨设备可见；旧 version 更新返回 409，不覆盖新内容。
- 用户 A 不能引用用户 B 的 draft/media/observation；猜 ID 返回不可枚举错误。
- 正文 600 字与独立 location 正常；非法 visibility/status/owner 字段被拒绝。
- 同一 Idempotency-Key 并发十次只创建一帖；同 key 不同 body 返回 409。
- 在“文件已写、DB 前”“post 插入后”“media 绑定后”“Outbox 前”故障注入，均无半帖/越权引用；临时文件最终清理。
- pending/rejected/private 帖不出现在不应出现的 feed，直接 post URL 和 media URL 也无法绕过。
- 已发布帖提交编辑时公众仍看到旧批准版本；第二个 pending 返回 409；revision 批准后原子切换，拒绝后旧版本不变。
- visibility 收紧、unpublish、清地点和删媒体立即生效；扩大公开范围进入审核。under_review/hidden/restore 的状态转换和媒体访问一致。
- report 重复、刷举报、无权限 moderation 决定被正确处理；每个决定都有 actor/reason/time。
- 未授权环境不能运行 role bootstrap；首个 moderator、撤销和再次授予都有独立审计行。
- 删除草稿、帖子和账号后，媒体状态及文件最终一致；worker 重跑幂等。

退出门槛：发布开关的每一项都有自动测试或可审计运行证据。

回滚：立即关闭 publish feature flag；保留草稿和 temporary media 供用户恢复，不 DROP 表。读取只能继续使用执行 visibility/moderation policy 的安全兼容 adapter；若回滚代码无法理解新状态，则切只读维护页，绝不能恢复旧无过滤查询。moderation 数据不可回滚删除。

### 阶段 4a：通知 REST、未读数与轮询（业务 MVP 完成）

**目标：** 用真实通知替换硬编码消息，“清空”只做全部已读。

实现项：

1. 完整执行 V009 notifications/preferences；不存在“部分应用迁移”。
2. follow/like/comment/moderation/publish 业务事务写 Outbox。
3. worker 幂等生成通知和稳定快照；按偏好过滤可选社交通知，必要系统/审核通知遵循最终规则。
4. 实现列表、未读数、单条已读、全部已读。
5. profile 页面使用独立通知偏好；community messages 使用真实接口。
6. 页面可见时 60 秒轮询未读；focus 立即校准；离线/隐藏暂停。

测试/验收：

- 业务事务提交但 worker 未运行时 Outbox 保留；重启后通知生成。
- worker 在通知插入后、标记 processed 前崩溃，重跑不重复通知。
- 自己点赞自己不通知；取消/再赞不刷重复垃圾通知。
- 列表、unread-count、read one、read-all 在并发和重试下最终一致。
- “清空”后历史仍在且 readAt 有值；没有 DELETE 请求。
- post 被删后通知仍有可解释快照，点击给出已不可用状态。
- emailNotifications=false 不被误当成关闭全部站内系统消息。

退出门槛：消息 UI、角标和偏好全部由服务端事实驱动；至此完成业务 MVP。

回滚：停止通知 consumer/隐藏消息入口；Outbox 保留待恢复，并监控 backlog 容量/最老事件年龄，超过阈值时关闭产生相应通知事件的非核心写或扩容处理。轮询关闭不影响核心帖子事务。

### 阶段 4b：SSE 实时增强

**目标：** 降低通知延迟，同时保留 REST/轮询恢复能力。

实现项：

1. 执行 V010，建立 user_event_stream 与 TTL cleanup。
2. 实现 `/api/v1/events`、Last-Event-ID replay、heartbeat、connection limit 和 `resync.required`。
3. 配置 Nginx `proxy_buffering off`、read timeout、禁缓存。
4. 客户端连接状态、指数退避、重复事件去重和 REST 补洞。

测试/验收：

- 断网、切后台、token 过期、服务重启、Nginx reload 后自动重连。
- Last-Event-ID 能重放保留期内事件；过期 cursor 触发 REST resync。
- 同一事件重复到达不重复插 UI；未读数最终和 REST 一致。
- 禁止跨 Origin 读取；每用户连接数和心跳资源受控。
- 关闭 SSE 后自动回到 60 秒轮询，没有功能损失。

退出门槛：在故障演练中不丢事实、不依赖内存事件序号。

回滚：`SSE_ENABLED=false`，客户端使用 REST 轮询；不回滚 V009/V010 数据。

### 阶段 5：生产化

**目标：** 在真实容量/RPO/RTO 信号出现时替换单机瓶颈，不改变业务 API。

实现项：

1. 完成对象存储复制、hash 校验、读 fallback、新写切换和生命周期。
2. 触发条件满足后执行 PostgreSQL 演练/只读切换。
3. 多实例前换共享 limiter、Outbox 租约与 SSE fan-out。
4. 增加数据库连接池、慢查询、索引审计和容量规划。
5. 完成结构化日志、metrics、tracing、告警、备份恢复与灾难演练。
6. 公开媒体 CDN；私密/关注者/审核中媒体使用短签名。
7. 依赖漏洞、镜像、secret rotation、最小权限和审计周期进入持续门禁。

测试/验收：

- 对象存储每个对象 size/hash 与 DB 一致，local fallback 命中率最终为零。
- PostgreSQL staging/production rehearsal 有行数、FK、DTO、聚合和媒体引用报告。
- 目标并发下 feed P95、写 P95、Outbox lag、SSE connections 和 error rate 达成批准的 SLO。
- 应用实例滚动重启不丢通知、不重复发布。
- 实际恢复演练达到批准的 RPO/RTO；不是只检查“备份文件存在”。
- SQLite/本机媒体回滚限制被书面确认，切写后不宣称无条件回滚。

回滚：对象存储按 adapter/fallback 回切；PostgreSQL 按第 13.4 节停写与反向数据策略执行。禁止同时迁数据库、存储和大批业务契约。

## 15. 测试、验收与可观测性总则

### 15.1 测试分层

| 层 | 必测内容 |
|---|---|
| 单元 | schema 边界、privacy/visibility policy、cursor、状态机、like/follow desired state、通知去重 |
| migration | fresh、upgrade、re-run、checksum、失败回滚、legacy import、backfill 行数与约束 |
| API 集成 | 两/三用户权限矩阵、CSRF/Origin、Idempotency、版本冲突、错误 envelope、媒体 owner |
| worker | 崩溃点、租约过期、重试、dead-letter、文件不存在、权限错误、consumer 去重 |
| 浏览器 E2E | profile false/null、following 空态/真实数据、like 刷新、草稿冲突、审核状态、通知已读、SSE fallback |
| 安全 | 越权 ID、字段注入、路径穿越、损坏媒体、像素炸弹、超限、日志脱敏、跨站请求 |
| 性能 | feed keyset、并发 like/follow/publish、SQLite lock、识别并发、Outbox lag、SSE 连接 |
| 恢复 | 自包含 SQLite 备份 + 两类媒体 bundle；人工 raw 副本场景的 DB+WAL；迁移失败、对象存储/PG 切换和回滚 |

所有写入型集成测试必须自行启动随机端口服务，使用临时 SQLite、community upload、observation upload 和环境变量；不得连接共享开发/生产库。teardown 要清理账号、帖子、观测、媒体和临时进程。

### 15.2 关键运行指标

- HTTP：route template、RPS、4xx/5xx、P50/P95/P99、request body rejected、429。
- SQLite/PostgreSQL：query latency、busy/lock、transaction duration、pool usage、migration version。
- 媒体：上传失败、签名/解码失败、temporary 数量、cleanup lag、orphan 数、磁盘/对象存储容量。
- 业务：profile 更新成功、follow/like/publish 成功、审核队列长度、report 数、通知 unread/outbox lag。
- SSE：活动连接、重连、replay、resync、每用户连接拒绝。
- 识别：并发、排队、模型加载、推理耗时/失败。

指标和日志中不得出现积分，也不得记录 email、密码、token、Cookie、Base64 或精确敏感地点。

### 15.3 完成定义

每个功能只有同时满足以下条件才算完成：

- schema migration、约束、回填报告和回滚说明齐全。
- v1 contract/OpenAPI、稳定错误码和兼容 adapter 齐全。
- 服务端鉴权、归属、可见性、审核和限流不能由前端绕过。
- 自动测试覆盖成功、空、未登录、无权限、冲突、429、故障和恢复。
- 日志/指标能定位失败，requestId 能贯穿 API 和 worker 事件。
- 删除/注销/过期数据的 DB 与媒体最终一致。
- 桌面/移动端没有 demo 或 localStorage 冒充服务器事实。

## 16. 回滚与兼容总策略

1. **先 feature flag，后删除旧路径。** Feed、like、publish、notifications、SSE 均独立开关。
2. **只做 expand。** 阶段 0-4 不 DROP/重命名现有业务表/列；V011 contract cleanup 单独立项。
3. **旧 API 只做代理。** 保留请求/响应形状，但业务必须进入同一 domain service/policy。
4. **当前只允许 feature-off 或 forward-fix。** 新候选失败先保持全站 maintenance、停止候选、恢复 runtime/static 指针，再发布经当前 schema 审查的修正版；禁止启动旧 `896c453`，也不把旧源码审计归档当可执行回滚包。兼容 schema 留在库中。
5. **备份是持久化写屏障下的 release bundle。** 全站 maintenance 生效、旧 Nginx worker/API 排空并停 PM2 后，先归档 community + observations 媒体、配置和旧 release 审计证据，再独立生成、pin 并验证自包含 DB 快照；pin 完成前不运行 migration。持续写入时分别复制不算一致备份。
6. **媒体延迟删除。** 先标记/隔离并保留 TTL，确认无引用和回滚窗口结束后再物理删除。
7. **迁移验证可机器读取。** 每次输出 migration version、表行数、FK/媒体 orphan、checksum。
8. **PostgreSQL 写入后回滚有条件。** 无反向同步时必须重新停写导出，不能直接指回旧 SQLite。
9. **兼容期有观测。** 统计旧 endpoint/legacy reaction 调用；流量归零、客户端版本达标后才 contract。
10. **积分不作为回滚兼容项，但数据先保留。** 不能因旧客户端而恢复积分业务；V002 不 DROP 旧积分表，后续归档/清理必须独立审批并有一致性备份与人工核对证据。
11. **账户状态有最低安全 runtime。** V003 开始使用 `account_status=deleting` 后，任何 forward-fix runtime 都必须拒绝所有非 active 用户；锁定提交会忽略该列且含破坏性启动 DDL，禁止启动。若修复需要兼容旧客户端，只能在安全 runtime 内提供 adapter，不能切回更早服务端。
12. **runtime release 必须 immutable 且彼此隔离。** live PM2 cwd 与 candidate 安装/测试目录不能相同；生产切换必须在 maintenance 中原子更新 runtime pointer/PM2 cwd，并验证新 PID 的真实 cwd。共享 `APP_DIR` 的原地更新一律 fail before install。
13. **migration 与激活必须有断电 journal。** 固定数据库快照后、migration 开始前，以 `migration-about-to-start` 原子持久化 `/var/lib/birdora-control/activation-pending.json`，migration 命令和 DB postflight 后分别推进阶段；verified marker 原子提交并 fsync 后才删除 journal 并 fsync control 目录。残留 journal 时恢复/保持 maintenance、拒绝部署并人工 reconciliation，不能靠 trap 或 HTTP 状态猜测完成。

### 16.1 Feature flags

| Flag | 生产默认 | 置 true 前置 | 负责人/回退 |
|---|---|---|---|
| `ACCOUNT_DELETION_ENABLED` | false | V002/V003、job items/worker、恢复测试、Product 批准 hard-delete/anonymize/retention mode | Backend + Ops + Product；关后返回 FEATURE_DISABLED |
| `CSRF_ENFORCEMENT` | report-only（阶段1过渡） | 统一 browser client 全量上线、缺失指标归零 | Backend + Frontend；最终 enforce，紧急时只回 report-only且保留 Origin Guard |
| `COMMUNITY_PUBLISH_ENABLED` | false | 阶段 3 发布安全硬门槛全部通过 + Product 批准 | Backend + Product；优先关闭写，保留安全读 |
| `COMMUNITY_POST_EDIT_ENABLED` | false | V008 revision/审核、旧 PATCH adapter、policy 测试 | Backend + Product；关后返回 EDIT_DISABLED |
| `COMMUNITY_DEMO_ENABLED` | false | 仅本地/测试 seed | Frontend；生产不可开启 |
| `COMMUNITY_LEGACY_LIKE_ENABLED` | false | 仅隔离开发/兼容测试可显式开启；真实帖 + 按钮 in-flight 禁用 | Frontend + Backend；V006 上线后永久保持 false |
| capability `socialFeedV1` | true | V004-V006、privacy/policy/cursor 测试已通过 | 安全规则与新 endpoint 已成为当前 schema 契约，不回旧模拟 feed |
| capability `canonicalLike` | true | V006 回填核对 + 兼容构建已通过 | canonical read/write 不回旧 toggle 表 |
| capability `cloudDrafts` | true | V007、版本冲突、幂等发布和原子事务测试已通过 | 前端失败时保留服务端草稿，不降级为共享模拟数据 |
| capability `notifications` | true | V009、同步事务通知、去重和偏好测试已通过 | 关闭 UI 不得删除 backlog；Outbox/SSE 仍单独建设 |
| capability `sse` | false | V010、Nginx、replay/fallback 测试 | Backend + Ops；启用前先完成轮询 fallback |

所有 flag 必须由集中配置读取，启动日志记录值但不记录 secret；readiness 暴露依赖是否满足，不允许只改环境变量绕过 migration/safety gate。推荐回退顺序为 SSE -> notification UI/consumer -> publish write -> social feed UI；visibility/moderation policy 和 canonical like 读源不是可关闭的安全规则。

## 17. 产品待确认项

| 待确认 | 路线建议默认值 | 阻塞点 |
|---|---|---|
| `publicProfile=false` 的最小公开身份 | 默认不公开 bio/avatar/年龄/性别；还需确认公开帖子、关注/粉丝列表和计数是否仍可见 | 阶段 2 privacy matrix |
| 年龄数据形态 | MVP 继续私有 age；后续评估出生年/年龄段，不默认公开 | 公开资料契约 |
| 私密资料能否被直接关注 | MVP 建议关闭新关注；是否需要申请制另立项 | follows policy |
| 是否把拉黑纳入 MVP | 建议阶段 2 前确认；若不做，明确不在本轮 | feed/互动可见性 |
| recommended 的含义 | MVP 为确定性公开发现流，不宣称个性化 | feed 文案/排序 |
| 匿名用户是否能看 recommended | 建议可看 approved public；following 必须登录 | feed auth |
| following 是否包含自己的帖子 | 建议不包含，自己的内容走 personal | feed 查询 |
| followers visibility 在取消关注后 | 建议立即失效；已缓存/签名媒体也需短 TTL | media/feed policy |
| helpful/curious 历史 | helpful -> like；curious 只读归档，不计赞 | V006/旧 UI |
| 旧帖 grandfather | 不建议无审计地全量通过；至少做规则扫描 + 抽样，决定是否仍回填 approved/public | V005 backfill |
| 默认 visibility | 建议 public；如果涉及未成年人/敏感地点可改更保守默认 | publish schema/UI |
| 先审后发还是规则通过即发 | 建议默认 pending；仅明确安全规则自动通过 | 发布门槛 |
| 举报达到阈值是否自动隐藏 | 不建议仅凭数量自动处罚；可进入 under-review | moderation policy |
| moderator/admin 人员与权限 | 必须指定最少人员、审计和应急隐藏权限 | 发布开关 |
| 拒绝后编辑重提/申诉、举报原因与 SLA | MVP 至少允许新 revision 重提；申诉、原因枚举和处置时限需确认 | moderation UX/ops |
| 草稿数量/保留期/自动保存 | 建议每用户上限、30 天无活动清理、约 1.5 秒 debounce；具体数确认 | 阶段 3 配额 |
| 草稿冲突体验 | 服务端 409，不自动覆盖；UI 提供保留本地/采用云端 | 多设备 |
| 单帖媒体数量、大小、时长 | 阶段 0 暂时 1 个媒体、图1MiB/视频8MiB；目标值需确认 | upload contract |
| 头像格式/大小/公开规则 | 暂沿用 JPG/PNG/WebP <=600KiB；V003 迁 media assets，公开受 publicProfile | profile/media |
| 地点隐私 | MVP 自由文本；珍稀鸟种/巢址是否模糊、延迟或隐藏需确认 | public post policy |
| 注销是硬删/匿名化/恢复期 | 建议短恢复期或匿名化，但以隐私政策决定 | account state/migration |
| 举报/审核/安全日志保留期 | 必须和注销策略一起确认 | 合规/清理 |
| 站内必要系统通知是否可关闭 | 建议审核/安全类不可关闭，社交类可关闭 | preferences |
| 通知保留期 | 建议先保留 90 天，最终以产品/隐私策略为准 | cleanup |
| “清空”未来是否真删除 | MVP 明确只 read-all；DELETE 另立产品需求 | messages UI |
| 旧 `/api/*` 兼容期限 | 建议至少两个部署窗口，并以访问日志归零为准 | V011 |
| PostgreSQL/对象存储供应商与 RPO/RTO | 由阶段 5 容量和运维约束选择，不在 MVP 提前绑定 | 生产迁移 |
| 阶段 3 前关闭生产发布是否接受 | 本路线默认接受；如不接受，必须先缩短阶段但不能跳过安全门槛 | 产品排期 |
| 量化验收阈值 | 确认 feed/write P95、测试数据量、Outbox 最老事件、RPO/RTO 和只读窗口 | 阶段 2-5 gate |

积分退役不是待确认项；本路线不接受“顺便恢复积分”的范围变更。

## 18. 下一批建议编码任务

阶段 0、关注/Feed/权威点赞、云草稿/发布事务和通知 REST 已在当前工作树实现；下一批不得重复建设这些接口：

1. 实现 V008 对应的举报、审核、内容隐藏/恢复、角色授权和审计 API，并建立最小管理界面。
2. 实现 Outbox claim/lease/retry/dead-letter worker，把非关键同步副作用逐步迁出请求事务；补积压与失败告警。
3. 为媒体建立 `media_assets` 写入/绑定/隔离/清理闭环，注销改为可恢复 job；在此之前保持生产注销关闭。
4. 在可访问的预发布域名执行注册、登录、资料、关注、发帖、云草稿、消息、私密媒体和退出的真实浏览器验收；本地 Codex 浏览器被客户端策略禁止访问 localhost，不能把当前静态/API 测试替代该门槛。
5. 在目标 Ubuntu 完成 legacy adoption、Nginx/PM2/锁/journal/恢复和逐相位故障证据；完成前保持生产 NO-GO。

当前工作树没有提交或推送授权；后续提交应按 migration、business API、frontend integration、deployment evidence 拆分，避免形成无法审阅的大提交。
