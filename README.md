# Birdora 观鸟眼镜 Web 网站

这是 Birdora 观鸟眼镜的 **Web 网站**，包含首页、鸟照识别、鸟类图鉴、分享社区和设备状态页面。前端是静态 HTML/CSS/JavaScript，后端是 Node.js + Express + SQLite；本仓库不是微信小程序，也不使用 WXML、`wx.*` API 或小程序云开发。

## v1.7 本地启动

如果只是看页面，可以直接双击 `index.html`。

如果要使用 OSEA 鸟类 AI 识别、账号登录和图文社区，需要同时启动前端静态服务器和后端 API 服务。

首次准备依赖和本地环境（PowerShell）：

```powershell
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

后端要求 Node.js `24.14.0` 或更高版本。

先显式执行 SQLite migration，再启动后端 API：

```powershell
pnpm db:migrate
pnpm start
```

开发环境的 `.env.example` 允许启动时自动迁移，但仍建议先显式执行上述命令。生产模板固定 `DATABASE_AUTO_MIGRATE=false`：`pnpm start` 只在监听端口前验证 schema，发现 pending migration 会直接退出，不会隐式改线上库。即使把生产环境误配成 `DATABASE_AUTO_MIGRATE=true`，普通 server 启动也会明确拒绝；只有 `pnpm db:migrate` 内部携带的 migration-command 授权可以 apply。

默认 API 地址：

```text
http://localhost:4000
```

本地后端默认允许这两个前端地址跨域访问：

```text
http://localhost:4174
http://127.0.0.1:4174
```

前端静态服务器：

```powershell
pnpm start:web
```

`pnpm start:web` 会先同步根目录的 HTML/CSS/JS 和 `assets/` 到 `public/`，再只从 `public/` 提供静态文件。

然后打开：

```text
http://localhost:4174
```

直接用 `file://` 打开时，浏览器可能会因为安全限制导致 ONNX 模型加载失败。

不要从项目根目录启动 `python -m http.server`，否则会暴露 `app/`、`docs/`、`server.js` 等后端私有文件。本项目的公开静态文件在 `public/`。

本地前端默认会请求 `http://localhost:4000/api`。如果要改后端地址，可以在加载 `script.js` 前设置：

```html
<script>
  window.BIRDORA_API_BASE_URL = "http://localhost:4000";
</script>
```

## SQLite migration 与健康检查

默认数据库为 `app/data/birdora.sqlite`，可通过 `DATABASE_FILE` 改到其他持久化路径。当前版本化 schema 为 V001-V009，覆盖基线采用、legacy 导入、运行基础、关注、帖子策略、权威点赞、草稿发布、审核基础表和通知；`schema_migrations` 会保存版本、名称、checksum 和执行时间，已执行的 migration 文件不得改写。完整接口与维护契约见 `docs/BACKEND_API_CONTRACT.md`。

上线前先运行严格只读的 preflight：

```powershell
pnpm db:preflight
```

它输出 JSON，包含 `mode=read-only`、当前/目标版本、pending 版本、完整性检查、用户表行数、是否必须备份、预计备份路径和磁盘容量。它不会建表、写 migration ledger、切 WAL 模式或创建备份；`ok=false` 时不得继续。存在 pending 时也可能返回 `ok=true`，其含义只是“备份/迁移门禁可满足”，不表示 schema 已就绪，更不授权生产 server 自动迁移；仍须显式运行 `pnpm db:migrate`。

对非空数据库应用 pending migration 时，`pnpm db:migrate` 会先用 SQLite `VACUUM INTO` 在 `DATABASE_BACKUP_DIR` 自动创建一致快照和 manifest，复查完整性、表清单/行数与 SHA-256，成功后才运行 migration。`DATABASE_BACKUP_ENABLED=false`、空间不足或备份验证失败都会阻止 migration。该自动备份**只包含 SQLite schema 和行数据，不包含社区/观测媒体**；媒体必须在同一停写窗口另行快照。

每次代码更新都必须固定一份数据库快照，即使当前没有 pending migration。backup-only 命令为：

```powershell
pnpm db:backup
```

只有数据库文件缺失或真正没有 schema 时，它才返回 `snapshotRequired=false`；任何已有 schema（包括已经是 V009、没有 pending 的线上库）都会返回验证后的 `backupPath`、`manifestPath` 和 `backupSha256`。PM2 安装脚本不依赖 `db:migrate` 内部的备份：停写、媒体/config bundle 完成后，它先独立执行 `db:backup`，把自包含 `.sqlite` 与 manifest 固定并校验到本次 rollback bundle，确认固定副本已持久化后才允许执行 `db:migrate`。

生产建议保留以下配置：

```text
HOST=127.0.0.1
DATABASE_AUTO_MIGRATE=false
DATABASE_BACKUP_ENABLED=true
DATABASE_BACKUP_DIR=/var/lib/birdora-protected/backups
DATABASE_BACKUP_RETENTION=20
ALLOW_EMPTY_DATABASE_INITIALIZATION=false
DIRECT_PORT_3003_FIREWALL_CONFIRMED=false
```

旧 `users.json` / `revoked-tokens.json` 的处理由 `LEGACY_JSON_IMPORT_MODE` 控制：

- `optional`：本地升级默认值；文件存在时导入一次，不存在时继续。
- `required`：仅用于有监督的旧数据切换；缺少任一旧文件即失败并回滚。
- `disabled`：生产和全新数据库推荐值；完全不读取旧 JSON。

迁移完成后可检查：

```text
GET http://localhost:4000/api/health/live
GET http://localhost:4000/api/health/ready
```

`live` 只表示 Node 进程仍在运行；`ready` 会检查数据库连接和目标 migration 版本，不就绪时返回 `503`。兼容路径 `/api/health` 当前与 `ready` 语义一致，部署探针应逐步改用显式的 `/api/health/ready`。

## 功能开关与 API 写入约束

以下高风险或兼容能力默认全部关闭，只有环境变量值（忽略首尾空格和大小写）明确为 `true` 时才会启用：

- `COMMUNITY_PUBLISH_ENABLED`
- `COMMUNITY_POST_EDIT_ENABLED`
- `COMMUNITY_LEGACY_LIKE_ENABLED`
- `ACCOUNT_DELETION_ENABLED`
- `COMMUNITY_DEMO_ENABLED`

前端通过 `GET /api/v1/capabilities` 获取公开能力和媒体限额；加载失败时按“关闭”处理。服务端路由仍会独立校验开关，因此隐藏按钮不是安全边界。生产环境不要为了通过 smoke 临时打开尚未完成路线图验收的功能。

所有带请求体的 auth、资料、识别、观测和社区写接口只接受 `Content-Type: application/json`，且顶层必须是 JSON 对象。其他媒体类型返回 `415 UNSUPPORTED_MEDIA_TYPE`，数组、字符串、`null` 等非对象 body 返回 `400 INVALID_REQUEST_BODY`。不带请求体的 logout 或 DELETE 路径不需要伪造空 JSON。

当前社区媒体契约为一帖最多一种媒体：

- 图片：JPEG / PNG / WebP，解码后最大 `1 MiB`。
- 视频：MP4 / WebM，解码后最大 `8 MiB`。
- 社区发布 JSON parser 为 `14 MiB`，Nginx `/api/` 请求体上限为 `16 MiB`，用于容纳 Base64 膨胀；普通 API parser 保持 `2 MiB`，小型社区写入为 `64 KiB`。

识别和观测图片仍限制为 `1 MiB`。前端提示、Express 校验和 Nginx 上限必须一起调整，不能只改其中一层。

## 主要文件

- `index.html`：页面结构
- `styles.css`：页面样式
- `script.js`：交互逻辑、图鉴数据、OSEA 模型推理逻辑
- `public/`：上线和本地预览时唯一应该托管的静态目录
- `server.js`：Express API 入口，在监听端口前完成数据库初始化或目标 migration 版本验证；生产普通启动不 apply migration
- `app/`：认证、社区、观测、识别路由，以及服务、功能开关和 SQLite 数据库
- `app/db/migrations/`：按版本执行且带 checksum 的 SQLite migration
- `scripts/database-preflight.js`：`pnpm db:preflight` 的严格只读迁移预检入口
- `scripts/backup-database.js`：`pnpm db:backup` 的无迁移数据库快照入口
- `scripts/migrate-database.js`：`pnpm db:migrate` 的生产/本地迁移入口
- `deploy/scripts/create-rollback-bundle.sh`：停写后快照社区/观测媒体、配置与旧 release 审计证据；旧源码归档只用于审计，不能执行回退
- `deploy/scripts/install-http.sh`：PM2 部署门禁原型；会在依赖安装前拒绝 live PM2 与 candidate 共用 `APP_DIR` 的原地更新，现网使用前仍须完成 immutable runtime release/cwd 原子切换重构
- `app/data/birdora.sqlite`：本地 SQLite 数据库，运行时自动创建，不应提交到 Git
- `app/data/uploads/community/`：默认本地社区图片/视频目录，不应提交到 Git；生产会跟随 `DATABASE_FILE` 所在目录
- `assets/atlas/bird-profiles.json`：已补充图文资料的富图鉴数据
- `assets/atlas/common-bird-candidates.json`：第二阶段 100 种常见鸟富资料补齐候选清单
- `assets/osea/bird_model.onnx`：来自 `sun-jiao/osea_mobile` 的鸟类识别模型
- `assets/osea/bird_info.json`：OSEA 鸟类标签信息
- `assets/vendor/`：浏览器运行 ONNX 模型需要的运行时文件
- `assets/`：首页、设备和鸟类图片资源

## 社区图文能力

当前后端已有以下兼容实现；发布、编辑和旧 reactions 点赞默认受功能开关关闭，不等同于阶段 2/3 的正式 Feed、幂等点赞或可靠发布：

- 登录用户发布图文文案。
- 发布和编辑时生成轻量文案分析，包含评分、摘要、标签和改进建议。
- 单帖可带 1 张 JPG / PNG / WebP 图片（最大 1 MiB），或 1 个 MP4 / WebM 视频（最大 8 MiB），不能同时带两种媒体。
- 其他账号浏览、评价、评论、提问。
- 作者编辑自己的标题和正文。
- 作者删除自己的帖子。
- 非作者编辑、删除会被后端拒绝。

实际接口前缀：

```text
/api/community/posts
```

媒体默认存储在 `DATABASE_FILE` 同级目录的 `uploads/community/` 下。例如生产数据库是 `/var/lib/birdora/birdora.sqlite` 时，图片和视频默认进入 `/var/lib/birdora/uploads/community/`。

可用 `COMMUNITY_UPLOAD_DIR` 显式指定社区媒体目录。

## 当前识别和图鉴范围

AI 识别已接入 OSEA 模型，会从 `assets/osea/bird_info.json` 的万级鸟类标签中返回 Top 5 候选。

图鉴第二阶段已开始：页面会用 OSEA 标签库生成 10,964 个基础图鉴索引，支持按中文名、英文名和拉丁名搜索。当前本地图鉴优先补充了 13 种常见鸟的图片和介绍：

- 翠鸟
- 白鹭
- 白头鹎
- 珠颈斑鸠
- 灰喜鹊
- 红嘴蓝鹊
- 黑水鸡
- 棕背伯劳
- 家燕
- 麻雀
- 喜鹊
- 大嘴乌鸦
- 小嘴乌鸦

未补齐百科资料的鸟种会显示“基础标签 / 图片待补充 / 资料待补充”，避免误导为完整图鉴。

注意：当前 OSEA 标签文件为 10,964 条，但模型观测输出为 11,000 维。页面会把未映射输出类作为候选展示，不会把它当成可信识别成功。不要对外宣称已全量覆盖 11,000 个输出类。

## 文案分析状态

当前项目支持图文发布、“带入识别结果”生成发布内容，并在后端生成轻量规则文案分析。分析结果会随帖子持久化，包含：

- 完整度评分
- 摘要判断
- 内容标签
- 改进建议

它不是独立大模型能力，尚未接入 AI 改写、AI 审核或多版本生成。

如果产品要求更强的“AI 文案分析”，需要继续新增独立模型接口、审核策略、测试和前端入口。

## 测试命令

核心后端门禁：

```powershell
pnpm test
```

`pnpm test` 当前依次覆盖 V001-V009 migration、旧库无损回填、只读 preflight/自动备份安全、双进程并发迁移、signed artifact、activation gate/journal、A/B pointer、严格生产配置、数据库锁解析、部署静态契约、前端/公开目录、Phase 0 后端，以及 auth/community/observation/social/draft/notification API 集成。需要定位问题时可分别运行：

```powershell
pnpm test:db
pnpm test:db:safety
pnpm test:db:concurrency
pnpm test:frontend-contracts
pnpm test:phase0
pnpm test:integration
pnpm test:release-artifacts
pnpm test:activation-gate
pnpm test:activation-journal
pnpm test:release-pointer
pnpm test:production-env
pnpm test:database-lifecycle-lock
pnpm test:deployment-contracts
```

Linux 的真实 `flock`、`/proc/locks` 与临时沙箱指针语义另跑 `pnpm test:linux:deployment`。非 Linux 会以退出码 77 报 `UNAVAILABLE`，不能算通过；完整 PM2/Nginx/固定生产路径仍需目标 Ubuntu 演练。

识别、图鉴和真实浏览器属于扩展验证：

```powershell
pnpm test:recognition:server
pnpm test:atlas
pnpm test:browser
pnpm test:peak
pnpm test:prod:readonly
```

`pnpm test:peak` 是轻量社区 API 峰值演练，已覆盖少量带图发布和图片读取；仍不覆盖真实浏览器静态资源、ONNX/WASM 首载或 5 人同时识别。

`pnpm test:browser` 会用本机 Chrome 跑真实浏览器注册、发布、跨账号互动、作者编辑和删除流程。它会创建账号和帖子，默认只允许本地地址；生产环境请使用隔离测试环境，不要直接指向正式站。

`pnpm test:prod:readonly` 只读检查正式站点、健康接口、私有文件隔离、OSEA 模型资源和同机相邻服务，不会写入生产数据。

## 线上有数据时的更新与回退

线上 SQLite 已有真实数据。本机 SQLite + 本机媒体当前不承诺无维护窗口的滚动热更；任何代码或 schema 更新都必须按以下顺序执行：

> **当前仍是生产 NO-GO：** 仓库已经实现 signed immutable A/B runtime/public pointer、专用 PM2、数据库生命周期锁和持久激活状态机，但主安装器只接受已经纳入该受管拓扑的服务器。现网若仍是共享可变目录或旧 PM2_HOME，必须先走单独审核的 legacy adoption；该流程尚未完成。目标 Ubuntu 的真实构件、`flock`/`/proc`、PM2、Nginx 和逐相位故障注入也尚未留存证据，因此不能把本地测试通过当作现网热更新授权。

1. 候选必须在生产机之外完成测试、生产依赖审计、依赖物化、构建证据、完整 manifest 和离线签名；生产 release 中禁止 `.env`、Git 元数据、真实数据和密钥。生产配置固定放在 root-only 的 `/etc/birdora/birdora-web-auth.env`，只由稳定外置 launcher 严格解析；launcher 同时取得 `/var/lock/birdora-web.deploy.lock`，不能直接执行 candidate 内控制器。
2. 在目标 Ubuntu 确认防火墙与端口。若旧服务通过 `0.0.0.0:3003`、`[::]:3003` 或 `*:3003` 监听，先在云安全组和主机防火墙封禁外网 TCP 3003，并从外部网络验证无法直连；只有这次受监督升级可临时设置 `DIRECT_PORT_3003_FIREWALL_CONFIRMED=true`，完成后立即恢复为 `false`。新服务必须只监听 `127.0.0.1:3003`。
3. 指向真实 `DATABASE_FILE` 运行只读 preflight，核对 ledger/checksum、current/target/pending、完整性、业务表计数、容量及数据库 device/inode。现有 writer、runtime pointer 与 `/var/lib/birdora-control/current-release.json` 必须形成同一个已验证版本事实；数据库缺失、空库、路径或 inode 漂移一律失败。首次把 legacy 主机接入该状态不能由日常 updater 猜测完成。
4. 受管升级只信任当前 marker、物理 runtime pointer、live `/proc/<pid>/cwd`、PM2 inventory 和旧签名 manifest 的一致结果；不从 `HEAD^`、分支父提交或 candidate 工作树推断线上版本。任一证据缺失或不一致就停止。
5. 脚本写入持久化 `/var/lib/birdora-maintenance/maintenance.flag`，把 **API 和整个静态网站** 都切到维护响应。Nginx 配置 `nginx -t`、reload 后，脚本会追踪并等待 reload 前的旧 Nginx worker 退出，再确认 API 与首页均为 `503`；随后排空 3003 已建立连接、停止旧 PM2 并确认端口关闭。旧 worker 未在时限内排空时也不迁移。
6. 停写后取得 `/var/lock/birdora-db-maintenance.lock` 的连续排他锁，再次确认同一非空数据库。恢复材料写入 root-only 的 `/var/lib/birdora-protected`，包含验证过的 SQLite 快照、媒体清单/归档和脱敏部署证据。只有快照及 SHA-256 已持久化，才能把 `/var/lib/birdora-control/activation-pending.json` 置为 `migration-about-to-start`，随后显式迁移；无 pending 的代码发布也保留同样门禁。
7. migration 命令成功后先推进 journal，随后再次 preflight，要求数据库存在、非空、无 pending、current=target，且既有业务表行数与停写前精确对账；postflight 成功后再把 journal 原子推进为 `database-migrated-candidate-not-yet-verified`。它覆盖 migration 开始前直到 release marker 提交之间无法由 shell trap 捕获的断电/SIGKILL。然后才原子切换 runtime pointer/PM2 cwd、启动候选 PM2，并检查 loopback `/api/health/ready`、精确 PID/bind 且不存在非 loopback listener。
8. API ready 后才把完整静态网站生成到唯一的 `.public-releases/<release-id>` staging 目录，生成逐文件 manifest，最后用原子 rename 切换 `.active-public` symlink；不在 Nginx 正在读取的目录里逐文件覆盖。随后再次 `nginx -t`、reload、等待旧 Nginx worker 排空，并在 maintenance 仍开启时完成最终 ready 检查。
9. 只有 API、数据库、恢复材料、两类媒体、静态 release 和 Nginx 全部就绪，才解除 maintenance 并验证公开读请求为 `200`、写请求仍被 journal 拦为 `503`。最后原子提交 `/var/lib/birdora-control/current-release.json`，再推进并清除 journal。migration 可能开始后的失败会停止候选并保持 maintenance/只读；public pointer 可按已知事实恢复，但 runtime pointer不会自动切回旧代码，也不会自动重启旧 API 或恢复写入，只能走人工核对后的 forward fix。

当前架构、目录权限、受信 launcher 调用形态、14 个 journal 相位和维护扩展清单见 [生产发布架构与维护手册](docs/PRODUCTION_RELEASE_ARCHITECTURE.md)。`deploy/scripts/install-http.sh` 不是可直接运行的入口，旧 `preflight.sh` 与 `enable-https.sh` 已固定以退出码 78 退役。在 legacy adoption 和 Ubuntu 门禁完成前，不提供现网执行命令。

Docker Compose 使用同一数据卷上的一次性 `birdora-migrate` 服务。它不会调用 PM2 专用的 rollback-bundle 脚本；先停止 Web 容器并对包含数据库与 `uploads/` 的卷完成等价快照，再执行 maintenance 步骤：

```bash
docker compose stop birdora-web
docker compose run --rm birdora-migrate npm run db:preflight
docker compose run --rm birdora-migrate npm run db:backup
docker compose run --rm birdora-migrate
docker compose up -d birdora-web
```

不要直接 `docker compose up -d` 期待生产容器自动迁移；`DATABASE_AUTO_MIGRATE=false` 时 pending schema 会让服务启动失败。Compose 流程没有 PM2/current-release 的空库保护、`flock`、host Nginx 全站 maintenance、immutable runtime/cwd 切换、activation journal、原子静态指针和 bundle pin 编排，不能把上述 PM2 runbook 直接套用到 Compose。运维必须另行设计并审核等价门禁；至少先核对目标 volume 不是现网数据丢失后的空卷，手工维持外部 maintenance，固定并验证 DB + 媒体/volume 快照，再执行 migration，并保存各命令 JSON。

### 目标 Ubuntu 上线前强制验收

**截至 2026-07-12，A/B 发布控制代码已经落地，但现有 legacy 服务器接管流程和目标 Ubuntu 运行证据仍是两项独立硬阻断。当前不具备生产执行条件，禁止直接对现网运行。** Windows 静态检查和 Node 单测不能替代这些证据。首次上线前必须在与目标机同版本的隔离 Ubuntu/候选机完成并留存输出：

- 用 release A 启动 live PM2、在独立 immutable release B 预先安装依赖/运行测试，证明 A 的源码、依赖、权限和 cwd 全程不变；随后在 maintenance 内原子切换 runtime pointer/PM2 cwd 到 B，并证明 PM2 实际 PID 的 `/proc/<pid>/cwd` 精确落在 B。当前 hard-coded/shared `APP_DIR` 形态必须在候选依赖验证前失败。
- `bash -n deploy/scripts/install-http.sh` 与 `bash -n deploy/scripts/create-rollback-bundle.sh`；再实际执行候选部署，不只做语法检查。并发启动两个部署，证明只有一个能取得 `flock`，另一个在任何 mutation 前失败。
- `nginx -t`，创建 `/var/lib/birdora-maintenance/maintenance.flag` 后 reload Nginx，验证普通 `/api/`、社区发布、首页和静态资源都返回维护 `503`；记录 reload 前 worker PID，证明脚本等待旧 worker 全部退出后才继续。
- `ss -lntp | grep ':3003'`，确认新 PM2 PID 只出现于 `127.0.0.1:3003`；再从另一台机器验证公网 IP/域名的 TCP 3003 无法连接。
- 在候选环境分别故障注入空库/错误路径、preflight、空间、媒体归档、备份、migration、postflight、候选 ready、两个指针、Nginx、公开验证和 marker 失败。每次失败都必须保持/恢复 maintenance、停止候选且不恢复写入；migration 可能开始后不得自动把 runtime 指针切回或启动旧代码，public 指针只可按实际状态安全恢复。
- 在 migration 前已固定快照后，验证 `activation-pending.json` 以 `migration-about-to-start` 通过临时文件 + rename + fsync 原子出现，并在 migration 命令完成、DB postflight 完成时逐阶段持久推进；分别在每个 journal 阶段、runtime 切换、候选启动、静态切换、公开验证和 current marker 提交后注入断电/SIGKILL。只要 journal 残留，重启/重跑必须先恢复 maintenance 并拒绝新部署，直到人工核对 DB、PM2 cwd、runtime/static 指针、bundle 与 marker 后完成 reconciliation。
- 跑一次“无 pending migration 的纯代码更新”，确认 migration 前 bundle 已包含并固定 `database-before-update.sqlite`、manifest/SHA-256、community + observations 的 `uploads.tar`/文件清单、配置和旧 release 元数据；再证明静态文件通过完整 staging + manifest + 原子 symlink 一次切换，不出现新旧文件混搭。
- 验证 `current-release.json` 在公开读请求通过且 journal 仍阻断写请求之前不存在新 marker；成功后最后写入且含 `activationVerified: true`，只有 marker 与 control 目录均 fsync 后才删除 journal。legacy adoption 必须证明流程从不依赖 `HEAD^` 或 candidate 猜测旧版本。
- 从 bundle 做一次离线 DB/媒体恢复和 forward-fix 启动演练，核对 DB 行数/完整性、两类媒体 hash、Nginx 与 loopback ready；未完成演练不得把该流程标记为生产可恢复。

V002 不再自动删除任何 legacy 业务表；它只停止运行时破坏性清理、记录一次性 legacy JSON 处理状态，并写入 `legacy-table-retirement-v1` 的 `deferred` 标记。旧表的归档或 `DROP` 必须延后到人工核对无依赖、已取得一致性备份且回滚观察窗结束后的独立版本。

当前回退策略是 **forward-fix-only**，没有自动 restore 或自动启动旧版的命令。特别禁止启动审计基线 `896c453019581de0c46948fd724311d606017fa0`（以及仍带同一旧启动路径的构建）：该版本启动时会执行 `DROP TABLE IF EXISTS user_point_events`，把它指向迁移后或恢复出的真实数据库都会重新引入破坏性 DDL。bundle 中的旧 marker、签名 manifest 和部署事实只作审计与恢复判断，不是可执行回滚包。

部署失败时必须保留全站 maintenance、停止候选 PM2 并按落盘事实处理指针：public 指针可安全恢复，migration 可能开始后 runtime 指针保持指向已停止的 forward-fix candidate，绝不自动启动旧后端。断电/SIGKILL 留下 journal 时，新部署失败关闭并等待人工 reconciliation。此时先另存现场、审查 migration/preflight/snapshot/bundle、PM2 cwd、两个指针与 marker，再修正候选代码或制作与当前 schema 明确兼容的新 forward-fix commit。只有经独立批准的灾难恢复才可在离线副本上使用 bundle 中的自包含 SQLite 与同点媒体；恢复后也只能启动已审计的安全 runtime，绝不能启动旧 `896c453`。

如果新版本解除 maintenance 后已经接收真实写入，恢复发布前快照会丢失这些写入；必须重新进入维护，先导出并核对增量，再决定 forward migration、数据合并或由业务负责人明确批准损失范围，不能宣称“一键无损回滚”。详细阶段门禁见 [后端开发路线图](docs/BACKEND_DEVELOPMENT_ROADMAP.md)。

## 继续开发提示

如果要增加更多富图鉴鸟种：

1. 在 `assets/atlas/bird-profiles.json` 增加资料条目。
2. 确认 `oseaIndex` 来自 `assets/osea/bird_info.json`。
3. 运行 `pnpm test:atlas` 检查字段、重复项和 OSEA 标签匹配。

页面会根据富图鉴资料里的 `oseaIndex` 自动建立 OSEA 标签到本地图鉴的匹配关系。

如果要从 100 种候选清单生成某个鸟种的富资料模板：

```bash
pnpm atlas:template 11
```

这里的 `11` 是 `assets/atlas/common-bird-candidates.json` 里的 `priority`。

第二阶段图鉴资料补齐说明见 `docs/bird-atlas-phase2.md`。

## 开源来源

鸟类识别模型来自：

https://github.com/sun-jiao/osea_mobile

该仓库使用 GPL-3.0 许可证。继续发布或改造时请注意遵守原项目许可证。
