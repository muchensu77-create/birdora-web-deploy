# Birdora 生产上线交接记录

记录日期：2026-06-29

## 1. 上线结论

Birdora 已完成正式域名 HTTPS 上线验收。

- 正式站点：`https://birdora.birdai-glasses.com/`
- 认证后端健康检查：`https://birdora.birdai-glasses.com/api/health`
- 服务器 IP：`39.106.221.224`
- 部署目录：`/var/www/birdora-web`
- 数据目录：`/var/lib/birdora`
- PM2 服务：`birdora-web-auth`
- Node 监听端口：`3003`
- Nginx：`80 -> 443`，`443 -> 静态 public/ + 127.0.0.1:3003/api/`

本次上线没有停止或修改现有业务服务：

- `birdora-api`
- `birdora-recognition...`
- `birdora-studio`
- `zhubao-api`
- PostgreSQL `127.0.0.1:5432`
- `jewelry-api.birdai-glasses.com`

## 2. 当前服务器状态

PM2 验收状态：

```text
birdora-api          online
birdora-recognition  online
birdora-studio       online
birdora-web-auth     online
zhubao-api           online
```

`birdora-web-auth` 使用独立 Node：

```text
/opt/node-v24/bin/node
Node.js v24.18.0
```

不要升级服务器全局 Node，避免影响旧服务。

## 3. HTTPS 和证书

Birdora 使用独立 Let's Encrypt 证书：

```text
/etc/letsencrypt/live/birdora.birdai-glasses.com/fullchain.pem
/etc/letsencrypt/live/birdora.birdai-glasses.com/privkey.pem
```

证书到期日：

```text
2026-09-27
```

Certbot 已设置自动续期任务。

Nginx 站点配置：

```text
/etc/nginx/sites-available/birdora.birdai-glasses.com
/etc/nginx/sites-enabled/birdora.birdai-glasses.com
```

不要修改 `jewelry-api.birdai-glasses.com` 的 server block。

## 4. 已完成验收

以下检查已在服务器端通过：

```text
https://birdora.birdai-glasses.com/                 HTTP/2 200
https://birdora.birdai-glasses.com/api/health       HTTP/2 200
https://birdora.birdai-glasses.com/server.js        HTTP/2 404
https://birdora.birdai-glasses.com/app/data/...     HTTP/2 404
https://jewelry-api.birdai-glasses.com              HTTP/2 200
```

API 健康检查返回：

```json
{"ok":true,"service":"birdora-auth-api","timestamp":"..."}
```

源码和数据库文件没有被 Nginx 暴露。

## 5. 日常运维命令

查看服务：

```bash
pm2 status
```

查看 Birdora 后端日志：

```bash
pm2 logs birdora-web-auth
```

重启 Birdora 后端：

```bash
pm2 restart birdora-web-auth
```

检查 Nginx 配置并重载：

```bash
nginx -t
systemctl reload nginx
```

健康检查：

```bash
curl -i https://birdora.birdai-glasses.com/api/health
curl -I https://jewelry-api.birdai-glasses.com
```

## 6. 数据和备份

认证数据保存在 SQLite：

```text
/var/lib/birdora/birdora.sqlite
/var/lib/birdora/birdora.sqlite-wal
/var/lib/birdora/birdora.sqlite-shm
/var/lib/birdora/uploads/community/
```

建议至少每日备份 `/var/lib/birdora/` 整目录，确保 SQLite 和社区图片一起恢复。

升级前先手动备份：

```bash
mkdir -p /root/backups/birdora
cp -a /var/lib/birdora /root/backups/birdora/birdora-$(date +%Y%m%d-%H%M%S)
```

## 7. 已知说明

上线时服务器终端最后出现：

```text
bash: _WARP_GENERATOR_COMMAND: unbound variable
```

这是终端环境脚本被 `set -u` 触发的提示，不是 Birdora、PM2、Nginx 或证书错误。前面的 HTTP/2、API、404 隔离、PM2 验收都已经通过。

后续在该终端里执行长命令时，如果不是必须，可以用：

```bash
set -eo pipefail
```

避免终端插件变量导致脚本尾部报错。

## 8. 下一步建议

P1：

- 用浏览器完整验证注册、登录、刷新保持登录、退出登录。
- 给 `/var/lib/birdora/` 加自动备份。
- 加一个轻量监控：定时检查 `https://birdora.birdai-glasses.com/api/health`。

P2：

- 鸟类识别能力继续由独立线程接手，不阻塞当前站点上线。
- 后续若要更新前端静态资源，先在本地跑验证，再同步到服务器并执行 `pnpm sync:public`。
