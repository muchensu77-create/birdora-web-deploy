# Birdora 旧生产服务器接管 Runbook（NO-GO 草案）

> 文档状态：**仅用于只读盘点、方案评审和隔离演练设计；不是生产执行手册，也不构成上线批准。**
>
> 当前结论：**NO-GO**。在本文的所有证据门禁、隔离 Ubuntu 演练和人工审批完成前，不得使用主更新器升级旧服务器，不得把本文转换为临时生产操作。
>
> 基线文档：[`PRODUCTION_RELEASE_ARCHITECTURE.md`](./PRODUCTION_RELEASE_ARCHITECTURE.md)。若两份文档有冲突，选择更严格、更失败关闭的约束。

## 1. 目的与边界

本文的目标是在不改变线上任何业务状态的前提下，回答三个问题：

1. 旧生产服务器现在究竟运行什么源码、进程、配置、数据库和媒体路径；
2. 它与目标“签名不可变 release + 原子指针 + 专用 PM2 + 激活 marker”拓扑存在哪些差异；
3. 要准备哪些可验证证据和隔离演练，才能另行设计一份可审批的生产接管执行附录。

本草案在生产上的授权范围只有**只读盘点**。它到“产出 GO/NO-GO 审批包”为止，不包含实际接管。任何最终进程切换、指针初始化、marker 提交或网关切换，都必须在未来的独立执行附录中逐步评审，不能从本文推导出生产命令。

### 1.1 当前仓库实现快照（2026-07-12）

当前仓库正在建设的是“旧环境只读证据”能力，不是 legacy adoption 执行器。文件存在、静态检查通过或收集结果为 `PASS`，都不能解释为已经获准操作生产：

| 构件 | 当前已实现 | 当前仍未完成/不代表什么 |
| --- | --- | --- |
| `deploy/schemas/legacy-adoption-evidence-v1.schema.json` | 严格 Draft 2020-12 v1 schema 已定义所有顶层/嵌套字段、未知字段拒绝、固定 check/manual 目录，以及授权常量；完整 live/quiesced fixture 已在本地通过 schema 验证 | schema 只验证报告结构，不验证生产事实，也不批准接管；R0 前仍需绑定精确文件 digest，并在后续变更时保持 schema/代码/fixture 同步 |
| `deploy/policy/legacy-inventory-policy.example.json` | 给出受限的应用根、DB、媒体根、PM2_HOME、站点、端口、app 名和大小上限示例；library 对字段和生产路径执行严格白名单；源码 hash 预批准清单默认空 | 只是仓库示例，不是生产策略，不应直接复制为审批；只有 R0 已逐文件证明不含 secret 的固定 identity 文件才能加入 `approvedRuntimeIdentityFiles`，否则 `runtime.identity-files` 必须阻塞 |
| `deploy/scripts/legacy-inventory-lib.js` | 初版库已有严格 policy/固定路径、有界读取、`/proc`/TCP/FD 投影、DB 文件身份与 opener、媒体聚合、PM2/Nginx/runtime/控制面投影、两遍一致性、原子报告、严格 evidence validator 和纯 verdict 等函数；定向与核心本地测试已通过 | 尚未完成真实 Linux syscall/文件访问/资源预算/竞态验证；库文件本身不是可获批的生产入口，本地测试不能证明生产安全 |
| `deploy/scripts/legacy-inventory.js` | 已有 Linux/root/fixed-path/fixed-Node/精确环境白名单/no-args bootstrap 初版，只调用固定 sibling library，并只输出脱敏结果 envelope；实验性 inventory 没有加入主发布 launcher 的必需 sibling，避免影响现有热更新 | 尚未在目标 Ubuntu 安装或执行，独立外层 launcher 的 `env -i` 调用契约与 inventory 控制面 bundle 完整性/原子安装也未获证明；不得复制到生产或从候选 release/临时路径试跑 |
| `scripts/evaluate-legacy-adoption-evidence.js` 与 `scripts/test-legacy-adoption-evidence.js` | 已有离线 CLI、文件边界、完整 v1 fixture、恶意 evidence 失败关闭、TCP parser、原子不覆盖和永不授权测试；定向测试与核心本地回归已通过 | evaluator 只接受人工项完整且全部为 `PENDING` 的不可变采集报告，并始终返回不授权；本地通过不等于 Ubuntu/生产验收，当前没有任何 legacy evidence 可以获得 GO |
| `scripts/test-legacy-inventory-linux-semantics.sh/.js` | 已有仅限新建 `/tmp` 沙箱的 Linux 语义测试入口，覆盖 no-follow、hardlink/FIFO、权限、原子报告、真实 proc 格式与可选 strace | 当前 Windows 主机未运行 Linux 主体；即使未来通过，也不覆盖固定生产路径完整 collector、PM2/Nginx 动态状态、真实生产 DB 零副作用或目标 Ubuntu 同构演练 |

此表只描述仓库当前开发状态。后续新增采集入口、校验器或测试时，维护者必须同步本节并保留未验证项；不能用“代码已经写完”替换 Ubuntu 证据和审批。

## 2. 绝对禁止项

从首次盘点到生产执行附录被正式批准之前，必须同时满足以下红线：

- 不停止、重启、reload、kill 或更换任何 Nginx、PM2、Node、systemd、cron 或未知后台进程。
- 不使用服务管理器保存、删除、复活或重写进程清单；不修改启动项。
- 不打开任何 SQLite 连接，也不导入 `node:sqlite`、应用数据库模块或候选 runtime；包括声称 `readOnly` 的连接、PRAGMA、integrity check、checkpoint、VACUUM、备份 API 或迁移探测。生产 DB 只允许观察文件系统元数据、sidecar 元数据和现存进程的已打开 FD 身份，证据必须明确记录 `sqliteConnectionOpened=false`、`logicalState=not_inspected`。
- 不写、替换、复制、移动、截断、压缩、快照或修复生产数据库及其 WAL/SHM/journal sidecar。
- 不执行数据库迁移，不创建迁移表，不更改 schema/user version，不导入测试数据，不运行会自动建库的应用。
- 不写、覆盖、同步、删除或重算上传文件、静态资源、日志、备份、PM2_HOME、Nginx 配置或系统目录。
- 不创建、删除或修改 runtime/public 指针、activation journal、current marker、maintenance flag 或任何锁文件。
- 不在生产目录执行 Git 更新、切分支、依赖安装、构建、测试、格式化、递归权限修复或手工代码修改。
- 不打印、导出、打包、复制或哈希任何 JWT secret、环境文件内容、TLS 私钥、签名私钥、token、cookie、凭据或原始进程环境。采集器如为绑定进程身份而有界读取固定 `/proc/<pid>/environ`，只能在内存中投影预批准的非敏感键，并把敏感项压缩为不含值/哈希/长度的类别存在标记；原始 bytes 不得进入错误、日志或报告。
- 不调用 PM2 CLI，也不导出原始 PM2 dump 或进程环境作为证据，因为它们可能包含 JWT secret。未来 v1 采集器只能直接、有界读取固定 PM2 dump 路径并立即生成字段白名单投影；原始 bytes、env、值的哈希/长度和命令行中的敏感片段都不得进入报告。
- v1 采集器不得启动 shell 或任何外部命令，包括 `pm2`、`nginx`、`systemctl`、`git`、`sqlite3` 及候选应用代码。无法从固定文件、文件系统元数据和 `/proc` 安全证明的事实必须写成 `UNKNOWN` 或 `MANUAL_REQUIRED`，不能为补证临时执行命令。
- 不为“方便盘点”临时放宽文件权限、sudo 规则、防火墙、SELinux/AppArmor、访问控制或校验逻辑。
- 不通过手工伪造 marker、把旧目录链接到 `releases`、把生产 `.env` 放入 release，或调低主更新器门禁来绕过 legacy 阻塞。

除已授权访问留下的操作系统审计日志外，未来受审查采集器唯一可申请的写入例外，是在预先配置、root-only、物理解析固定的证据目录中原子创建一份最终脱敏报告。不得接受 CLI 自定义输出路径，不得在应用、DB、媒体、PM2_HOME、Nginx 或临时目录落盘。此例外只有在入口、无覆盖写协议、fsync、大小上限、脱敏和 Ubuntu 系统调用审计均通过 R0 后才生效；当前仓库状态尚未获得该生产授权。

## 3. 角色分离与人工审批

不得由一个人同时担任实现者、证据收集者和最终批准者。最小角色集为：

| 角色 | 职责 | 不得做的事 |
| --- | --- | --- |
| 业务/数据负责人 | 确认生产数据范围、维护窗口和可接受停机上限 | 不以口头“可以”代替书面审批 |
| 生产运维 | 持有服务器访问权，执行已批准的只读收集 | 不执行临时操作或超出白名单的“顺手检查” |
| 后端/数据库负责人 | 解释进程、schema 和兼容要求，设计脱敏演练 | 不直接使用生产密钥或原始数据调试 |
| 安全审核人 | 审查证据白名单、脱敏、secret 边界和签名链 | 不接受任何 secret 值、进程 env 或未脱敏 dump |
| 独立复核人 | 复核证据、演练和不变量，作出 GO/NO-GO 建议 | 不使用实现者的口头结论代替原始证据 |
| 事故指挥人 | 预先审批失败关闭和中止决策树 | 不在事故中即兴放开写入或启动旧 writer |

审批分为五道门，不得跨越：

1. **R0：只读盘点授权。** 批准服务器范围、时间、收集项白名单、脱敏规则和中止条件。
2. **R1：盘点证据接受。** 四方确认证据完整、无 secret、无状态修改，并冻结一份拓扑差异清单。
3. **L0：隔离演练准入。** 确认隔离 Ubuntu 主机和由数据负责人独立提供的脱敏数据集可用；本 runbook 不授权从生产生成或转移它们。
4. **L1：演练证据接受。** 独立复核人确认所有成功场景和故障注入通过，且无 schema/data/media/secret 漂移。
5. **P0：生产执行附录审批。** 只有新建、逐行审查、在演练中完整跑通的执行附录才能进入此门。本文不满足 P0。

任意一个角色拒绝签字、证据过期或现状漂移，结论自动回到 **NO-GO**。

## 4. R0 前的范围冻结

连接生产前，先在非生产环境冻结一份收集计划。必须包含：

- 唯一的盘点编号、服务器资产编号、环境标识、时区与授权时间窗；
- 执行人、观察人、安全复核人和可随时中止的业务联系人；
- 一份精确的只读收集项白名单，每项注明数据源、输出字段、脱敏规则和预期大小；
- 一份禁止路径/文件类型清单，至少覆盖 secret、进程 env、PM2 dump、数据库内容、上传文件内容和用户日志内容；
- 一份由两人复核过的收集器设计。收集器除获批的固定最终报告外不得落地临时文件；“不修改 atime”的承诺不能作为唯一保证，需同时评估目标挂载选项、页缓存影响与审计日志影响；
- 中止条件和证据污染处置人；
- 明确声明本次不进入 maintenance，不请求业务停机，不改变流量，不调用主更新器。

v1 采集器不运行任何命令。确有无法从固定文件和 `/proc` 证明的事实时，将其标记为人工项；人工观察方法只能存放在受控运维系统内，不放入本仓库文档，也不得被采集器拼接或调用。它必须先在等价隔离主机证明无写入、无 secret 输出、无长时间锁和可预期资源开销，再由 R0 独立审批并形成单独证据。

## 5. 只读盘点证据包

### 5.1 证据质量规则

每个证据项必须有唯一 ID，并记录：

- 服务器资产编号和收集时间（UTC 与当地时间）；
- 数据源和观察方法版本；
- 收集人和现场复核人；
- 是原始元数据、脱敏摘要还是人工结论；
- 脱敏规则和被排除字段；
- 证据文件在外部受控证据库中的 SHA-256、创建人和访问控制；
- 与其他证据的关联，例如进程 PID 对应的 cwd、监听端口和 DB 文件 device/inode。

不得为了“保留原始证据”而保留 secret、未脱敏进程环境或业务数据内容。这类输出一旦出现就是证据污染/潜在泄露事件，不是可接受的附件。

### 5.2 v1 采集与离线校验的分离契约

未来 v1 工具必须将“观察生产事实”和“解释证据”做成两个独立阶段：

1. **Linux-only 采集器**只能从稳定 root 控制面路径运行，使用固定 Node、清空继承环境、不接受路径/命令/修复/接管类参数，并读取 root-only 固定策略。候选 release 不得决定它执行什么。
2. **生产侧数据源**仅限固定普通文件、可信目录元数据和 `/proc` 投影。不得建立网络连接、打开 SQLite、加载应用代码、执行 PM2/Nginx/systemd/Git/SQLite CLI 或通过 shell 间接调用它们。
3. **脱敏先于持久化。** 原始进程环境、原始 cmdline、原始 PM2 dump、secret 值/哈希/长度、DB 内容、媒体内容和媒体文件名均不得落盘。媒体只允许输出有界聚合、数量/字节及链接/特殊文件统计；PM2 只允许输出 app/进程身份白名单投影。
4. **两遍一致性。** PID/starttime/cwd/exe、socket inode、DB device/inode/sidecar、PM2/Nginx/控制文件身份和媒体聚合等关键事实需在有界时间内重采并比较。漂移时只可重试有限次数；仍不稳定则不形成“可审查成功”，以临时不稳定状态失败关闭。
5. **唯一落盘例外**是固定受保护证据目录中的最终报告，使用单链接、无符号链接、不可覆盖、固定权限、文件与父目录 fsync 的原子协议。任一步无法证明时不得留下半成品作为正式证据。
6. **离线校验器**在受控分析环境读取证据，验证 schema、脱敏边界、一致性、阻塞检查和固定 `PENDING` 人工项目录。它不读取或合并“已确认”状态，不连接生产，也没有执行修复、迁移、停服或接管的能力；任何输出始终不授权。
7. **人工确认不回写采集报告。** 采集器必须输出完整固定目录且全部为 `PENDING`；确认人另行签署绑定原报告 SHA-256、证据引用、身份和时间的记录。缺失、重复、未知或 `REJECTED` 项都失败关闭，不能直接编辑 JSON 把状态改成 `CONFIRMED`。

当前 JavaScript 初版还有两项不可豁免的 **P1 工程门禁**，任何现有 check 的 `PASS` 都不覆盖它们：

- **启动前可信环境。** 脚本内的环境白名单只能在 Node 已启动后拒绝输入，不能阻止 `NODE_OPTIONS` 或 `LD_PRELOAD` 在此之前执行。生产候选必须先有 root-owned、digest 绑定的外层控制器或服务管理器，以最小固定环境直接 `execve` 固定 Node，并在 Node/动态加载器执行不受信代码之前排除继承环境；必须用 `NODE_OPTIONS`、`LD_PRELOAD` 注入反例证明失败关闭。普通 shell 包装或仅在 JavaScript 中删除环境变量不合格。
- **目录 FD 锚定解析。** 当前 `lstat`/`realpath`/末级 `O_NOFOLLOW` 与随后按字符串路径打开之间仍存在中间目录 symlink/rename 竞态，普通读取/目录遍历也可能按挂载策略更新 atime。生产候选必须用经审查的原生路径 helper，以受信目录 FD 为锚，使用 Linux `openat2` 的 `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV`（或独立证明语义等价的机制）完成每次读取和遍历，并使用 `O_NOATIME` 或已验证的 noatime 挂载语义；必须通过并发 symlink/rename swap 与 atime 零变化反例。重复元数据快照不能替代此门禁。

在这两项实现、目标 Ubuntu 负测和独立审查完成前，collector 只能称为 **NO-GO 盘点原型**，不得复制或安装到生产。其报告和 evaluator 即使没有其他阻塞项，也不能被解释为已满足 R0、R1 或 P0。

采集超过文件数、目录深度、总读取字节、耗时或报告大小预算时，必须将相关检查标记为不完整并阻塞，不能把截断聚合当作全量事实。`collectorErrors`、check reason 和路径分类必须来自固定代码/枚举与严格投影；不得把原始异常、任意路径、命令行或系统消息复制进证据。

采集器输出中的授权字段永远固定为 `inventoryOnly=true`、`adoptionAuthorized=false`、`mutationAuthorized=false`；离线 verdict 也永远固定 `authorizesAdoption=false`、`authorizesMutation=false`。`live-discovery` 即使所有自动检查通过，最高只能到 `DISCOVERY_COMPLETE_REQUIRES_QUIESCED_RECAPTURE`。最终绑定证据必须在未来另行批准的维护窗口中、所有已知 writer 已由独立执行流程停止后重新采集；采集器本身不得停止 writer。此后仍需人工确认、隔离演练和 P0 审批。

两个 phase 的机器判定不同：`live-discovery` 要求唯一 loopback listener、其真实 `/proc` 环境和执行脚本与 policy 一致，并要求同一 PID 已打开 policy 指定 DB；PM2 只提供持久 entry/status 投影，不声称 dump 绑定 live PID，完整管理器/复活关系仍是人工项。`quiesced-binding` 则要求 `3003` 无 listener、生产 DB 无任何已观察到的打开 descriptor，且固定 PM2 主 dump 中的旧 writer entry 为 `stopped`。只把 policy 文本改成 `quiesced-binding`、但旧进程仍存活，必须触发 listener、DB quiescence 或 PM2 persistence 阻塞，绝不能得到待人工评审状态。

入口还会要求自身与 PID 1 处于同一 PID/mount/network/user namespace、PID 1 是 systemd/init，并拒绝常见 container marker/cgroup；四项 namespace 同一性分别以布尔字段进入证据，任一不匹配即不生成正式报告。该结果只能称为 `hostEnvironmentCandidate`，不能证明不存在所有容器或嵌套 namespace；真实宿主身份仍须由 R0 资产记录和目标 Ubuntu 外部证据确认。

### 5.3 必收证据矩阵

下表是最终审批包的目标证据范围，不等于当前 v1 collector 已自动实现全部项目。当前报告只输出严格 schema 中已有的安全投影；时区、发行版、挂载/防火墙、完整服务管理器、静态等价基线等无法在无命令边界内证明的事实，必须保持未确认或阻塞，并由后续独立证据补齐，不能因为表中列出就视为已采集。

| ID 前缀 | 对象 | 允许收集的脱敏证据 | 明确不收集 | 接受标准 |
| --- | --- | --- | --- | --- |
| HOST | 主机基线 | 从固定 proc/sys 文件与元数据得到的 Ubuntu/内核、CPU 架构、时区、文件系统与挂载属性；无法无命令证明的工具版本标记为人工项 | 密码、SSH 私钥、云 metadata token、完整公网拓扑；任何版本探测命令 | 能与未来隔离主机逐项比较；敏感网络标识已脱敏，未观察项没有被猜测为通过 |
| SRC | 当前运行代码 | 运行进程的物理 cwd/可执行路径、预批准非敏感 identity 文件哈希；固定文件中声明的 revision 只能标记为未受信 claim | `git` 命令、仓库内 `.env`、用户上传、日志、凭据文件、生产源码整树打包 | 另有受信证据把实际运行基线绑定到可重建 revision；不能绑定即阻塞 |
| PROC | 进程拓扑 | 已知 writer 的 PID、PPID、uid/gid、start time、cwd、可执行文件、脱敏命令形状、管理器与重启关系 | 进程 env、命令行中的 token/secret、PM2 dump 内容 | 能排除第二 writer、未知 worker、定时任务和其他 PM2_HOME 的复活路径 |
| NET | 流量与监听 | 脱敏后的监听地址/端口、PID 绑定、反向代理拓扑、防火墙规则摘要 | TLS 私钥、cookie、请求体、Authorization header、用户 IP 日志 | API 能被证明只通过预期网关暴露；异常直连或多监听器立即阻塞 |
| PM2 | 进程管理 | PM2_HOME 物理路径及权限元数据、固定 dump 的有界白名单投影、脱敏 app 名/数量、启动用户；无法从固定文件证明的 resurrect 关系标记为人工项 | PM2 CLI、原始 dump bytes/env、值的哈希或长度、JWT secret | 所有可能复活 writer 的 PM2_HOME 均被识别；混合其他应用或证据不足列为阻塞差异 |
| NGINX | 网关与静态站 | 固定已批准配置文件的元数据、仅用于两遍一致性比较且不导出的内部 token、同一 server block 的脱敏 server/upstream/TLS 投影；任何未展开 include 只记录 `unexpandedIncludePresent` | 配置原文或 digest、`nginx -T/-t`、reload、私钥内容、访问日志、用户 header、未脱敏内网地址 | direct 配置满足目标站点、TLS 443 与 loopback upstream 时阻塞型磁盘投影可通过；include 不视为已解析，`nginx.unexpanded-includes` 固定转入非阻塞人工项，并由 `nginx-and-tls-external-state` 独立确认 |
| DBID | 生产 SQLite 身份 | 规范物理路径、device/inode、文件类型、owner/mode/link count、size/mtime、挂载点、WAL/SHM/journal 是否存在及其身份元数据、writer 已打开 FD 的 device/inode 对应 | DB/WAL/SHM 内容、SQL 结果、用户行、文件副本、内容哈希 | 应用实际打开的主 DB 唯一且与声明路径一致；无法证明则 NO-GO |
| MEDIA | 上传/媒体根 | 规范路径、device/inode、owner/mode、挂载点、文件数/总字节摘要、符号链接/越界挂载统计 | 上传文件内容、文件名中的用户信息、影像本身、完整文件清单 | 社区和观测两个根均被唯一识别；越界路径立即阻塞 |
| STATIC | 当前前端 | 物理 root、owner/mode、文件数/字节数、预批准静态 manifest 摘要 | 用户产生文件、服务器日志、未脱敏 runtime 配置 | 能识别未来 `.active-public` 的等价基线；不变更 Nginx root |
| SECRET-META | 外置配置/密钥 | 文件是否存在、规范路径、类型、owner/mode/link count、父目录信任元数据；公开验签公钥可单独审批 fingerprint | 任何 secret 值、secret 哈希、环境文件键值、私钥、token，以及任何副本 | 只证明 secret 边界和权限，不导出内容；发现不安全权限即阻塞并进入安全处置 |
| AUTO | 旁路 writer/自动化 | 从固定目录元数据和 `/proc` 可得的脱敏线索；systemd timer、cron、容器、监控自愈和外部部署平台的完整拓扑默认列为人工确认 | 服务管理命令、凭据、webhook secret、脚本中的 secret 内容 | 人工与自动证据共同证明没有未知机制会在接管时重启旧 writer 或修改 DB；仅靠采集器不得标记为已证明 |
| CTRL | 新控制面前置条件 | 目标路径是否存在及其元数据；现存 runtime/public pointer、journal、marker、lock 的元数据 | 不创建、删除、修改或“修复”任何控制文件 | 完整列出 legacy 与目标拓扑差异；缺失是预期证据，不得当场补齐 |

### 5.4 不能在生产盘点中证明的内容

以下结论不能仅靠初次生产元数据盘点得出，必须在由数据负责人独立提供的隔离数据集上证明：

- SQLite `integrity_check`/`foreign_key_check`、schema 消化、业务表行数不变量；
- 旧库是否能被等价基线 runtime 以 `DATABASE_AUTO_MIGRATE=false` 启动；
- PM2 共享 FLOCK、维护排他锁、`/proc/locks` 和 PID/inode 解析在目标内核上的语义；
- Nginx 维护屏障、loopback-only listener、断电/SIGKILL 下的指针与 marker 持久化；
- PM2 stop/save/delete/resurrect 在目标版本下的真实行为；
- 签名基线 release 是否与当前生产行为等价，且不要求任何 DB/schema/data 变化。

## 6. 只读盘点的立即中止条件

出现任意一项时，立即停止收集，保留已脱敏的审计记录，不做当场修复：

- 工具尝试在固定受保护证据目录之外创建文件、覆盖既有报告、留下正式报告临时文件、取得排他业务锁、触发 sudo 写权、打开编辑器或请求服务重启；
- 输出中出现 secret、token、cookie、Authorization header、环境值、私钥或原始用户数据；
- 无法唯一确定正在运行的 writer，或发现第二 writer/未知自愈机制；
- 应用打开的 DB device/inode 与配置声明不一致，或 DB/媒体路径经过未审批符号链接/挂载；
- 生产业务出现异常、延迟、资源竞争或监控告警；
- 收集结果超出白名单字段/大小，或脱敏器行为与隔离测试不一致；
- 实际主机、账号、时间窗或资产编号与 R0 审批不一致。

如果 secret 已出现在证据通道，将其作为潜在泄露事件：限制证据访问，通知安全负责人，按审批的事故流程评估撤销/轮换。不得把“删除本地副本”当作事件已解决的证明。

## 7. R1 拓扑差异报告

盘点后只产出差异报告，不在服务器上补齐结构。报告至少对照以下目标状态：

| 目标能力 | 旧环境证据 | 差异分级 | 未来解决条件 |
| --- | --- | --- | --- |
| 可重建且行为等价的精确源码基线 | SRC 证据 ID | 阻塞/重大/一般 | 从受信源控制恢复精确 revision，或另行审批受控源码恢复与 secret 扫描 |
| 签名、不可变的 runtime release | SRC/CTRL | 阻塞 | 在生产外构建等价基线，完成证据、manifest、离线签名和公钥复验 |
| 受控 runtime/public 原子指针 | CTRL/STATIC | 阻塞 | 只能在已演练执行附录中初始化；不手工补齐 |
| formatVersion 2 verified marker | CTRL/DBID/MEDIA | 阻塞 | 由已演练的 CAS + fsync 控制流程生成，不根据手工推测创建 |
| 专用 PM2_HOME 及唯一 writer | PROC/PM2/AUTO | 阻塞 | 证明旧复活路径已受控，候选持共享 DB 锁，且无混合 app |
| 外置 secret 与受信控制面 | SECRET-META/CTRL | 阻塞 | 不复制 secret；另行验证外置 launcher、controller bundle 和 PM2 secret 风险 |
| 受管 DB 与媒体身份 | DBID/MEDIA | 阻塞 | 生产接管必须保留主 DB device/inode 和媒体根；不覆盖、不迁移 |
| Nginx 维护屏障与 loopback API | NET/NGINX | 阻塞 | 先在隔离主机演练同构配置和故障关闭 |

差异报告必须明确标记“已证明”、“证据不足”、“与目标矛盾”或“缺失”，不得把“没发现异常”写成“已证明安全”。

## 8. 隔离 Ubuntu 演练

### 8.1 演练输入的来源边界

隔离演练不使用生产 secret，不连接生产网络，也不由本 runbook 从生产复制 DB/媒体。其输入必须是：

- 与 HOST 证据一致的 Ubuntu、内核、文件系统、Node、PM2、Nginx、util-linux、ACL/capability 工具版本；
- 隔离账号、独立网络和测试 TLS/应用 secret，不与生产值相同；
- 由数据负责人通过另行批准的备份/脱敏流程预先提供的一致性数据集；本文不授权该生成或转移操作；
- 不含可识别用户媒体的结构等价测试集，或经正式审批、已脱敏且受访问控制的快照；
- 从受信源控制重建的精确旧基线代码，不把生产工作目录当作构建源；
- 一个从干净 committed worktree 生成、依赖已物化、完整 manifest 已离线签名的等价基线 release。

如无法从受信源控制重建当前运行行为，不能通过“大概是这个分支”进入演练。需另行审批源码恢复、完整 secret 扫描与行为对照；在它完成前保持 NO-GO。

### 8.2 必须覆盖的演练场景

未来 legacy-adoption 实现和执行附录必须在隔离主机上至少连续两次从干净基线完成以下场景，其中一次由非实现者执行：

1. **纯接管，零迁移。** 等价基线 release 不执行任何 migration，不新建 migration 控制表，不改 schema/data/media；只将运行拓扑收敛到受管状态。
2. **无可用 migration 时仍成功。** 演练环境必须明确关闭自动迁移；候选不能通过“顺便升级 schema”才能启动。
3. **未知第二 writer。** 存在另一个进程、timer、container 或 resurrect 路径时，流程必须在任何数据/指针变更前失败。
4. **基线不可重建或签名不匹配。** 流程保持旧拓扑不变，不允许未签名目录成为 current。
5. **DB 身份漂移。** 路径相同但 device/inode 改变、符号链接、库被替换或存在意外 sidecar 时必须拒绝。
6. **候选无法 ready。** 必须保持维护/失败关闭、无第二 writer，且不自动对 DB 或旧进程作未批准操作。
7. **在每个持久化边界强制中断。** 覆盖进程转换前后、runtime/public 指针前后、marker 提交前后、journal 清理前后和机器重启。
8. **PM2 部分失败。** 覆盖 stop/save/delete/resurrect 的目标版本行为，证明旧或候选 writer 不会被意外复活。
9. **Nginx/静态切换失败。** 后端、DB 和前端指针分别核对；静态恢复不能被当作后端回滚。
10. **marker/journal 不一致。** 写请求必须失败关闭；不允许通过手工删文件开放写入。
11. **磁盘满、权限/ACL/capability 异常、跨挂载 rename。** 必须在状态不可证时停止，不降级校验。
12. **secret 注入与 PM2 dump。** 使用测试 secret 验证候选、launcher 和 dump 的边界；不得将生产值带入演练。

### 8.3 演练接受标准

每次演练必须留存 revision、artifact manifest digest、测试数据集 ID、主机基线、开始/结束不变量、故障注入时间点、持久化状态和恢复结论。只有同时满足以下条件才能由 L1 签字：

- 全程无 migration，无 schema 变化，无业务行增删改，无媒体增删改；
- 主 DB 不被替换，并且逻辑 schema digest、业务表行数和关键约束前后一致；
- 任何中断都只会导向“保持维护/只读 + 单 writer 或零 writer + 可证状态”；
- 候选运行于签名物理 release，持有同一 DB lifecycle shared lock，仅 loopback 监听；
- runtime/public 指针、PM2 物理 cwd、marker、DB identity、media roots 与 artifact digest 形成同一个可证版本事实；
- secret 只来自演练专用外置源，release、证据、日志、marker、journal 和恢复材料中均无 secret；
- 独立复核人能仅凭持久化证据重建每个故障点的真实状态，而不依赖终端最后一行输出。

“成功跑过一次”、Windows 单元测试、静态 lint 或 shell 语法通过不足以满足 L1。

## 9. 等价签名基线 release 的前置条件

legacy adoption 的第一个受管 release 必须是“运行拓扑收敛”，不是“顺便发布新功能”。它必须同时证明：

- 对应 SRC 证据中的精确可重建 revision，且编译/运行行为与旧生产基线等价；
- 在不迁移的脱敏旧库上能启动、readiness 和服务读取，不会自动建库/建表/写默认数据；
- 没有新业务功能、新定时任务、新 worker、新 API 写入语义或新生产配置义务；
- 生产依赖已在隔离构建环境物化，发布树无符号链接、硬链接、特殊文件、扩展 ACL 或 capability；
- 构建证据、完整 manifest 和离线签名绑定同一 revision/lockfile；
- 私钥不在构件或生产服务器上，生产只有已批准的验签公钥；
- 数据库、uploads、secret、PM2_HOME、journal、marker 和静态资源都不嵌入 runtime release。

当前仓库不应被解读为已提供并验证了这个“旧基线等价层”。如果等价性无法证明，legacy adoption 继续 NO-GO，不得直接使用最新后端代码代替它。

## 10. 最终接管前后不变量

本节只定义未来 P0 执行附录必须证明的状态，**不描述如何在生产切换到该状态**。

| 类别 | 接管前必须冻结的事实 | 接管后必须证明的事实 |
| --- | --- | --- |
| 业务流量 | 维护窗口、旧入口、许可停机上限、已知监控基线 | 流量只通过已批准 Nginx 入口；API 只监听 loopback；无旁路端口 |
| 源码/构件 | 旧 writer 的精确物理 cwd、revision/文件身份、行为基线 | `current` 精确指向已签名不可变等价 release；manifest digest/revision 和审批一致 |
| 数据库文件 | 主 DB 规范路径、device/inode、owner/mode/link count、挂载点和 sidecar 状态 | 主 DB 路径与 device/inode 不变；未被备份、样例库或新空库替换；权限边界不放宽 |
| DB 逻辑状态 | 在已停止业务写入的未来窗口内，由已演练只读方法取得 schema digest、user/schema version、迁移表集合/校验和业务表行数 | 上述值完全不变；无 migration，无新控制表，无业务行增删改；完整性/外键检查通过 |
| 媒体 | 两个上传根的规范路径、device/inode、owner/mode、文件数/字节数和已批准 manifest | 路径、身份、内容 manifest 不变；无覆盖、无清空、无意外符号链接/挂载 |
| 进程 | 所有 writer/resurrect 路径、PID/cwd/uid/gid、管理器和端口 | 专用 PM2_HOME 中只有一个已批准 API writer；物理 cwd 与 `current` 一致；持有同一 DB shared lifecycle lock；旧 writer 无复活路径 |
| 静态网站 | Nginx 物理 root 与静态基线 manifest | `.active-public` 指向不可变受控静态目录；Nginx 实际 root 与指针一致 |
| 激活状态 | 空闲时不应有未知 pending 状态；旧环境缺少 marker/指针被记为差异 | formatVersion 2 `current-release.json` 绑定 release、artifact、PM2 PID、DB identity、media roots 和 public target；无 pending journal；丢失/不匹配时写入失败关闭 |
| secret | 只记录规范路径、owner/mode/link count 和父目录边界，不记录值/哈希 | secret 源路径和权限边界不变；无新副本进入 release、日志、证据、marker、journal 或恢复包；PM2 dump 风险已被专门验证并批准或消除 |
| 控制面 | 目标路径缺失/差异的只读证据 | launcher/controller/helpers 是同一已签名/哈希、原子安装的受信 bundle；版本协议与 release 匹配；不存在部分更新 |
| 审计 | 完整 R0/R1/L0/L1/P0 证据链与审批人 | 实际状态与审批的 revision/digest/数据 identity/时间窗一致；任何偏差均有中止记录 |

“页面能打开”不是接管完成证据。后置不变量必须同时成立，否则仍然是不可证的部分接管。

## 11. 失败矩阵

下表中“未来执行阶段”只定义安全结果，不授权任何生产操作。实际处置必须写入另行审批且已演练的 P0 附录。

| 阶段/观察 | 当前安全结论 | 所需证据/人工决策 | 禁止行为 |
| --- | --- | --- | --- |
| R0 未批准或服务器身份不符 | 不连接、NO-GO | 重新确认资产、时间窗和角色 | 边盘点边补审批 |
| 只读收集器请求写权/排他锁/服务操作 | 立即中止收集 | 保留审计事件，在隔离主机重新评审工具 | 临时授权或点选确认继续 |
| 证据中出现 secret/用户数据 | 按潜在泄露处置，盘点 NO-GO | 安全负责人确定暴露范围、撤销/轮换和证据隔离 | 把未脱敏输出附在工单、聊天或 Git |
| 运行源码无法绑定可重建 revision | legacy adoption NO-GO | 单独启动源码恢复和行为等价评审 | 用最近分支猜测替代 |
| 多 writer、多 PM2_HOME 或未知 resurrect 路径 | legacy adoption NO-GO | 完成所有 writer 清单和未来 maintenance drain 设计 | 只停掉看得见的一个进程 |
| DB 路径/inode/打开 FD 不一致 | legacy adoption NO-GO | 数据负责人识别真实主库和业务影响 | 初始化新库、复制样例库或改路径“统一” |
| 媒体根越界、挂载或内容身份无法证明 | legacy adoption NO-GO | 补充脱敏媒体身份方案和恢复证据 | 递归复制、同步或修权限 |
| 隔离主机与 HOST 基线不等价 | L1 不可签字 | 重建同构环境或明确差异后重演 | 用 Windows/容器静态测试替代 Ubuntu 证据 |
| 等价基线启动时会建表/迁移/写默认数据 | 基线无资格，NO-GO | 修复自动写入路径，重建、重签并从干净数据集重演 | 接受“只写了控制表” |
| 隔离演练后 schema/行数/媒体不变量改变 | L1 失败，NO-GO | 确定每一项 delta 来源，修复后重新完整演练 | 将 delta 列为“可忽略”或删掉校验 |
| 故障注入后出现两个 writer/开放写入/状态无法重建 | L1 失败，NO-GO | 修复状态机、锁和恢复证据后从头重演 | 用手工步骤“救回来”后计为通过 |
| 未来执行前任一证据与 R1/L1 漂移 | P0 自动失效，不得开始 | 重新只读盘点并重走相关门禁 | 只更新表格中的时间戳 |
| 未来执行阶段：旧 writer 已转入维护，候选无法 ready | 保持维护，维持单 writer 或零 writer，不自动操作 DB | 事故指挥人根据已演练分支审批后续；如考虑恢复旧 writer，必须先独立证明 DB/schema/data 从未变化且旧代码身份精确 | 同时启动旧/新 writer，或临时直接启动 Node |
| 未来执行阶段：runtime/public/marker 仅部分持久化 | 保持维护/只读，根据实际持久化事实判断 | 核对两个指针、journal、marker、PM2 PID/cwd、DB identity 和 artifact digest | 盲目重试、手工删 journal 或造 marker |
| 未来执行阶段：发现任何 DB/schema/data/media 变化 | 停止接管，保持写入关闭，按数据事故处理 | 保存不含 secret 的状态证据，由数据负责人和事故指挥人审批恢复路线 | 用空库/旧备份直接覆盖，或隐藏 delta |
| 未来执行阶段：secret 被复制到 release/dump/证据 | 安全事故，接管失败 | 隔离产物、评估撤销/轮换，重新构建无 secret 构件 | 继续发布后再清理 |

## 12. P0 前的最终审批包

未来只有当下列材料齐全，才可以审查生产执行附录；这不代表自动 GO：

- R0 授权和全部只读证据索引；
- 不可变采集报告的 digest，以及独立人工确认文件/签字记录；确认文件必须绑定该 digest、确认人、时间、证据引用和结论，不能修改原报告；
- 采集器、库、policy 和 schema 的精确版本/哈希，以及独立离线校验器版本；
- 目标 Ubuntu 上的系统调用与文件访问审计，证明采集器没有启动外部命令、没有网络连接、没有打开 SQLite/业务内容，并且唯一写入是固定目录内不可覆盖的最终脱敏报告；
- 恶意 policy、路径替换、符号/硬链接、PID 重用、采集中漂移、超大 proc/dump/media、secret 注入、部分写入和并发报告名冲突测试；
- R1 拓扑差异报告，每个结论可追溯到证据 ID；
- 精确旧基线 revision/行为等价报告；
- 等价签名 release 的 revision、manifest digest、构建证据和审批人；
- 隔离主机同构矩阵、数据集 ID/脱敏批准，且无生产 secret；
- 至少两次完整演练与所有故障注入证据；
- 不变量前后对照，明确证明零 migration、零 schema/data/media 变化；
- 一份独立的、经演练的生产执行附录，包含每个持久化边界、预期证据、超时、中止和人工决策点；
- 单独的旧 writer 恢复/不恢复决策树，不依赖未证明的自动回退；
- 已验证的数据库与媒体恢复材料；创建该材料需独立备份流程授权，不由本只读 runbook 执行；
- 签名密钥生命周期、控制面 bundle 原子安装和 PM2 secret/dump 风险的审批证据；
- 维护窗口、回报频率、用户通知、事故指挥人和明确停机上限；
- 业务/数据、运维、后端/数据库、安全与独立复核人的签字。

审批记录必须绑定精确服务器、执行附录版本、revision、artifact digest、数据库 identity 和时间窗。任一项变化后不可复用旧签字。

## 13. 未来生产执行附录的必要结构

本文不创建该附录。它在 L1 之后单独编写时，至少必须包含：

1. 精确的前置证据校验和有效期，任何漂移在维护之前失败；
2. 与主发布器分离、专用于首次接管的受审查状态机；
3. 每一步的前置不变量、唯一允许变化、后置不变量和可持久证据；
4. 一个从头到尾不运行 migration、不替换 DB、不改媒体、不复制 secret 的接管路径；
5. 所有旧 writer 和 resurrect 路径的受控转换，并证明任一时刻不存在两个 writer；
6. 专用 PM2_HOME、shared DB lifecycle lock、runtime/public 指针、journal 和 formatVersion 2 marker 的原子初始化；
7. 受信 controller bundle 的版本化、完整性、原子安装和旧版保留证据；
8. 每个可能中断点的失败关闭行为和人工恢复决策；
9. 验证主 DB device/inode/schema/data 和媒体 manifest 前后不变的方法；
10. 一个不写入真实业务数据的最终健康验证方案；
11. 明确的最大中断时间、超时后的事故升级和“不自动恢复旧 writer”默认策略；
12. 完成后由独立复核人从物理状态重建版本事实的签字页。

执行附录不得是现场拼接的命令记录，不得只描述成功路径，也不得在生产第一次验证失败分支。

## 14. 当前明确阻塞

在获得强证据之前，下列项目均视为未完成：

- [ ] 尚未完成获批的 R0 只读生产盘点；
- [ ] 当前已有严格 evidence schema/policy、Linux 采集入口/library、两遍一致性/原子报告、离线校验和本地定向/核心回归；尚未完成控制面受信安装、真实 Linux syscall/文件访问/资源预算/竞态审计和 Ubuntu 行为验证，因此任何文件都不得安装或试跑到生产；
- [ ] 尚未形成任何绑定真实报告 digest 的独立人工确认文件或 R1 签字；evaluator 返回的 `PENDING` 清单不能自行转化为确认，更不能授权接管；
- [ ] 尚未证明当前运行源码的精确可重建 revision 和行为等价性；
- [ ] 尚未证明唯一 writer、所有 PM2_HOME/systemd/cron/container 复活路径；
- [ ] 尚未以只读证据确认真实生产 DB 和媒体根的物理身份；
- [ ] 尚未获得等价 Ubuntu 隔离环境和由数据负责人独立提供的脱敏一致性数据集；
- [ ] 尚未构建、签名并证明一个零迁移的等价旧基线 release；
- [ ] 尚未在目标 Ubuntu 对只读采集器做 syscall/文件访问/资源上限/竞态实测，也尚未有经目标 Ubuntu 实测的 legacy-adoption 状态机；
- [ ] 尚未实现并验证 Node/动态加载器之前清空继承环境的 root-owned 固定启动控制器；JavaScript 环境白名单不覆盖 `NODE_OPTIONS`/`LD_PRELOAD` 的启动前执行；
- [ ] 尚未实现基于目录 FD 和 `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV)` 或已证明等价机制的路径读取，也未证明 `O_NOATIME`/noatime 下文件与目录 atime 零变化；当前字符串路径检查不覆盖中间目录 symlink/rename TOCTOU；
- [ ] 尚未完成 `/usr/local/libexec/birdora` 控制面 bundle 的独立完整性与原子安装证明；
- [ ] 尚未解决或正式接受 PM2 dump/进程环境可能复制 JWT secret 的风险；
- [ ] 尚未完成全部故障注入、两次独立演练和 L1 签字；
- [ ] 尚未编写、演练、独立审查并批准 P0 生产执行附录。

因此，当前可以继续的工作只是：在非生产环境冻结 schema/policy/collector/evaluator 的精确 digest，完成独立代码复核、受信控制面安装演练、真实 Linux syscall/文件访问/资源预算/竞态审计和等价 Ubuntu 演练，再提交 R0 审批。R0 之前不得把开发中工具复制到生产；R0 之后也只能在监督下执行被哈希绑定的只读盘点。任何阶段都不得打开生产 SQLite、影响现有网站服务，也不得使用主更新器试探旧服务器。

## 15. 签字记录模板

| 门禁 | 证据包 ID / digest | 结论 | 未解决项 | 负责人 | 审批人 | 时间 | 过期条件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R0 只读盘点授权 | 待填 | NO-GO | 待填 | 待填 | 待填 | 待填 | 服务器/白名单/时间窗任一变化 |
| R1 证据接受 | 待填 | NO-GO | 待填 | 待填 | 待填 | 待填 | 拓扑、进程、DB/media identity 任一漂移 |
| L0 演练准入 | 待填 | NO-GO | 待填 | 待填 | 待填 | 待填 | 主机基线/数据集/release 任一变化 |
| L1 演练接受 | 待填 | NO-GO | 待填 | 待填 | 待填 | 待填 | 执行附录或实现任一变化 |
| P0 生产执行附录 | 未存在 | NO-GO | 本文不提供执行附录 | 待定 | 待定 | 待定 | 任一绑定证据/审批变化 |

在 P0 还是 `NO-GO` 时，任何人都不得将表格中的“未解决项”改成空白来代替证据。
