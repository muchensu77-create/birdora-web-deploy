# Birdora 网站部署入口（当前状态）

> **NO-GO：当前不得把仓库中的发布控制器直接用于承载真实数据的生产服务器。**
> A/B 发布架构已进入代码与本地契约测试阶段，但 legacy 主机接管、真实无链接 pnpm 构件、目标 Ubuntu 锁语义以及完整故障注入仍未验收。

Birdora 是 Web 网站：Nginx 提供浏览器静态资源，Express API 只监听 `127.0.0.1:3003`。本文件不包含微信小程序发布步骤。

## 权威文档

- [生产发布架构与维护手册](PRODUCTION_RELEASE_ARCHITECTURE.md)：当前目录、权限、签名、锁、激活状态机、恢复矩阵和维护清单。
- [后端开发路线图](BACKEND_DEVELOPMENT_ROADMAP.md)：接口、数据库迁移和后续业务阶段。
- [README](../README.md)：本地开发、测试和当前能力说明。

若旧文档、历史交接或服务器上的命令与上述架构冲突，以“失败关闭并停止操作”为准，不能凭旧 runbook 继续。

## 已退役入口

以下两个旧脚本固定返回退出码 `78`，不会读取或修改生产状态：

- `deploy/scripts/preflight.sh`
- `deploy/scripts/enable-https.sh`

它们曾面向可变源码目录和旧 PM2/Nginx 拓扑，不能证明签名构件、部署锁、数据库锁、激活 journal 或 current marker，因此不能作为新流程的预检或 HTTPS 安装入口。

也禁止以下旧做法：

- 在 `/var/www/birdora-web` 原地 `git pull`、安装依赖、构建或递归改权限；
- 把生产 `.env`、SQLite、uploads、JWT secret 放进 release；
- 直接执行 candidate 内的 `install-http.sh`；
- 使用 `pm2 restart` 合并旧 cwd/环境，或手工启动第二个 SQLite writer；
- 迁移后启动旧 revision 或把 runtime 指针盲目切回旧代码；
- 绕开 maintenance、journal 或 marker 临时恢复写接口。

## 当前允许的本地验证

下列命令只针对本地工作树和测试临时目录，不连接生产数据：

```bash
pnpm test
pnpm test:atlas
pnpm test:release-artifacts
pnpm test:deployment-contracts
```

Linux 专项语义测试为：

```bash
pnpm test:linux:deployment
```

非 Linux 环境会输出 `UNAVAILABLE` 并以 `77` 退出；这不是通过。该专项当前验证临时沙箱中的 `flock` 与 A/B 指针原子性，仍不代表 PM2/Nginx/固定生产路径集成已验收。

所有写入型浏览器/API 测试必须使用隔离数据库和 uploads，不能把地址、数据库路径或环境配置指向正式站。

## 生产发布控制面（尚未授权执行）

目标架构只接受：

1. 在生产机之外完成依赖物化、全部测试、生产依赖审计、构建证据、完整 manifest 和离线签名；
2. 将不可变构件放到独立 `releases/<revision>-<digest>` 物理目录；
3. 由 `/usr/local/libexec/birdora/run-with-production-env.js` 读取 `/etc/birdora` 的严格外置配置并取得全局部署锁；
4. 在 maintenance 下停止旧 writer，持有数据库排他锁，固定 DB/媒体恢复材料，再显式迁移；
5. 按 14 阶段 journal 推进 runtime、PM2、public、Nginx、只读公开验证与最终 marker；
6. 只有 verified marker 已持久化且 journal 已安全清除后才恢复写入。

这段描述是架构约束，不是现阶段的生产操作授权，也不替代 Ubuntu 演练和变更审批。

## 解除 NO-GO 的最低条件

- 完成现有服务器到专用 `PM2_HOME`、immutable runtime/public pointers 和 control/protected 目录的只读盘点与 legacy adoption 演练；
- 用真实 production artifact 证明 `node_modules` 已物化且无 symlink、hardlink、ACL、capability 或不可读文件；
- 在同版本 Ubuntu 验证 `/proc/locks`、fdinfo、shared/exclusive `flock`、PM2、Nginx worker drain、loopback 与防火墙；
- 使用脱敏 DB/媒体副本逐相位注入失败、SIGKILL 和重启，并完成 forward-fix 与离线恢复演练；
- 留存 artifact digest、DB identity、journal/marker、两个指针和恢复结果，由非实现者复核。

在这些证据齐全前，只继续本地开发和隔离演练，不连接、停止、迁移或重启真实生产服务。
