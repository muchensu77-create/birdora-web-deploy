# Birdora 服务器部署说明

更新日期：2026-06-29

本文档用于单机服务器部署。当前推荐形态：

- Nginx 只托管 `public/` 静态前端文件
- Node.js 运行 Express 认证 API
- SQLite 保存认证数据
- PM2 管理 Node 进程

如果部署到已经运行 `birdora-api` 和 `zhubao-api` 的服务器，必须先看防冲突计划：

```text
docs/server-conflict-safe-plan.md
```

## 1. 服务器要求

- Node.js `24.14.0` 或更高版本，建议为本项目单独安装到 `/opt/node-v24`
- pnpm `11.x`
- Nginx
- PM2
- HTTPS 证书

不要上传或提交本地 `node_modules`。
不要把项目根目录作为 Nginx 静态根目录；只能托管 `public/`。

如果服务器全局 Node 低于 `24.14.0`，不要直接升级全局 Node，避免影响现有 PM2 服务。使用独立 Node 24：

```bash
cd /tmp
NODE_TARBALL="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk '/linux-x64.tar.xz/ {print $2; exit}')"
NODE_DIR="${NODE_TARBALL%.tar.xz}"
curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$NODE_TARBALL"
tar -xJf "$NODE_TARBALL" -C /opt
ln -sfn "/opt/$NODE_DIR" /opt/node-v24
/opt/node-v24/bin/node -v
```

## 2. 部署目录和依赖

准备部署目录：

```bash
mkdir -p /var/www/birdora-web
chown -R root:www-data /var/www/birdora-web
find /var/www/birdora-web -type d -exec chmod 755 {} \;
find /var/www/birdora-web -type f ! -name ".env" -exec chmod 644 {} \;
```

上传源码到 `/var/www/birdora-web`，不要上传 `node_modules`、`.env`、本地数据库或日志。

安装依赖：

```bash
cd /var/www/birdora-web
pnpm install --frozen-lockfile
```

同步公开静态目录：

```bash
pnpm sync:public
```

也可以使用内置脚本完成预检和 HTTP 阶段安装：

```bash
cd /var/www/birdora-web
bash deploy/scripts/preflight.sh
bash deploy/scripts/install-http.sh
```

## 3. 环境变量

生产环境必须设置。源码上传后可以从模板复制：

```bash
cd /var/www/birdora-web
cp deploy/env/birdora-web-auth.env.example .env
chmod 600 .env
```

然后编辑 `.env`，至少替换 `JWT_SECRET`。

目标内容：

```bash
NODE_ENV=production
NODE_INTERPRETER=/opt/node-v24/bin/node
PORT=3003
CORS_ORIGIN=https://birdora.birdai-glasses.com
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-chars
JWT_EXPIRES_IN=7d
JWT_COOKIE_NAME=birdora_token
AUTH_RATE_LIMIT=30
DATABASE_FILE=/var/lib/birdora/birdora.sqlite
TRUST_PROXY=1
```

注意：

- `JWT_SECRET` 必须是强随机值。
- 不要使用模板里的 `replace-with-*` 占位值；生产服务和安装脚本都会拒绝它。
- `CORS_ORIGIN` 必须是前端正式域名。
- `DATABASE_FILE` 建议放到 `/var/lib/birdora/` 这类可持久化、可备份的数据目录。
- `TRUST_PROXY=1` 适用于 Nginx 反向代理到 Node.js 的单代理部署。

## 4. 数据目录

```bash
sudo mkdir -p /var/lib/birdora
sudo chown -R root:root /var/lib/birdora
chmod 700 /var/lib/birdora
```

SQLite 数据库会在服务启动时自动创建。
如果 PM2 不是以 `root` 用户运行，需要把 `/var/lib/birdora` 的属主改成实际运行 PM2 的用户。

## 5. DNS 和 HTTPS 证书

先确认 DNS 已经指向服务器：

```bash
dig +short birdora.birdai-glasses.com
```

预期返回：

```text
39.106.221.224
```

DNS 未生效前不要申请证书。DNS 生效后，为 Birdora 单独申请证书：

```bash
cp deploy/nginx/birdora-pre-cert.conf /etc/nginx/sites-available/birdora.birdai-glasses.com
test -e /etc/nginx/sites-enabled/birdora.birdai-glasses.com || ln -s /etc/nginx/sites-available/birdora.birdai-glasses.com /etc/nginx/sites-enabled/birdora.birdai-glasses.com
nginx -t
systemctl reload nginx
curl -I http://birdora.birdai-glasses.com/
certbot certonly --webroot -w /var/www/birdora-web/public -d birdora.birdai-glasses.com
```

证书申请完成后，用最终 HTTPS 模板替换 Birdora 站点配置：

```bash
cp deploy/nginx/birdora-https.conf /etc/nginx/sites-available/birdora.birdai-glasses.com
```

每次修改 Nginx 后都要执行：

```bash
nginx -t
systemctl reload nginx
```

也可以在 DNS 生效后使用内置脚本申请证书并启用 HTTPS：

```bash
cd /var/www/birdora-web
bash deploy/scripts/enable-https.sh
```

注意：

- 不要修改 `jewelry-api.birdai-glasses.com` 的 Nginx server block。
- 不要停止 `birdora-api`、`zhubao-api` 或 PostgreSQL。

## 6. 启动后端

开发式启动：

```bash
pnpm start
```

PM2 启动：

```bash
cd /var/www/birdora-web
pm2 start ecosystem.config.cjs --update-env
pm2 save
```

查看日志：

```bash
pm2 logs birdora-web-auth
```

## 7. Nginx 示例

以下示例假设：

- 域名：`birdora.birdai-glasses.com`
- 项目目录：`/var/www/birdora-web`
- 静态根目录：`/var/www/birdora-web/public`
- Node 后端：`127.0.0.1:3003`

```nginx
server {
  listen 80;
  server_name birdora.birdai-glasses.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name birdora.birdai-glasses.com;

  ssl_certificate /etc/letsencrypt/live/birdora.birdai-glasses.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/birdora.birdai-glasses.com/privkey.pem;

  root /var/www/birdora-web/public;
  index index.html;

  location ~ ^/(app|docs|scripts|node_modules|\.git)(/|$) {
    return 404;
  }

  location ~ ^/(server\.js|package\.json|pnpm-lock\.yaml|ecosystem\.config\.cjs|README\.md|\.env) {
    return 404;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3003/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ =404;
  }
}
```

同域部署时，前端会默认请求 `/api/*`，cookie 在 HTTPS 下正常工作。

## 8. 上线验证

```bash
curl -i https://birdora.birdai-glasses.com/api/health
```

浏览器验证：

- 打开 `https://birdora.birdai-glasses.com/login.html`
- 注册新账号
- 登录后跳转首页
- 刷新首页后保持登录
- 点击退出登录
- 登出后回到登录页

后端测试：

```bash
AUTH_BASE_URL=https://birdora.birdai-glasses.com pnpm test:auth
```

## 9. 备份

至少备份：

```text
/var/lib/birdora/birdora.sqlite
/var/lib/birdora/birdora.sqlite-wal
/var/lib/birdora/birdora.sqlite-shm
```

建议每天做一次快照，并在升级前手动备份。

## 10. 回滚

保留上一版代码目录和数据库备份。

代码回滚：

```bash
pm2 stop birdora-web-auth
cd /path/to/previous/birdora-web
pnpm install --frozen-lockfile
pm2 start ecosystem.config.cjs
```

数据库回滚：

1. 停止 PM2 服务。
2. 恢复 SQLite 备份文件。
3. 启动 PM2 服务。
4. 重新验证登录注册流程。
