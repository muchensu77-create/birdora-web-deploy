# Birdora 同服务器防冲突部署计划

更新日期：2026-06-29

## 1. 已知同机服务

服务器上已经运行另一个项目后端，部署 Birdora 时不能影响它。

服务器信息：

```text
服务器 IP：39.106.221.224
系统：Ubuntu 24.04.2 LTS
SSH 用户：root
SSH 端口：22
本机 SSH 别名：guanniao
登录命令：ssh guanniao
Nginx：80/443
PostgreSQL：127.0.0.1:5432
```

现有服务：

```text
现有 Birdora API：
  PM2 服务：birdora-api
  Node 监听端口：3000

珠宝后端：
  API：https://jewelry-api.birdai-glasses.com
  健康状态：HTTP 200
  部署目录：/root/zhubao-backend
  PM2 服务：zhubao-api
  Node 监听端口：3002
  Nginx：443 -> http://127.0.0.1:3002
```

## 2. 禁止触碰项

上线 Birdora 时不要修改、停止或覆盖：

```text
/root/zhubao-backend
PM2 服务 birdora-api
PM2 服务 zhubao-api
Node 端口 3000
Node 端口 3002
PostgreSQL 127.0.0.1:5432
jewelry-api.birdai-glasses.com 的 Nginx server block
```

上线前后都要确认现有服务仍然正常。

```bash
pm2 status birdora-api
pm2 status zhubao-api
curl -I https://jewelry-api.birdai-glasses.com
```

## 3. Birdora 推荐隔离方案

Birdora 使用独立目录、端口、PM2 名称、数据库目录和 Nginx 站点配置。

建议配置：

```text
部署目录：/var/www/birdora-web
PM2 服务：birdora-web-auth
Node 监听端口：3003
SQLite 数据目录：/var/lib/birdora
SQLite 数据库：/var/lib/birdora/birdora.sqlite
Nginx 静态根目录：/var/www/birdora-web/public
正式域名：https://birdora.birdai-glasses.com
```

端口选择说明：

- `3000` 已被现有 `birdora-api` 使用，新网站后端不使用。
- `3002` 已被 `zhubao-api` 使用，新网站后端不使用。
- 推荐用 `3003`，和现有服务相邻但不冲突。
- 如果服务器上 `3003` 已被占用，再改用 `3004` 或其他空闲端口。

## 4. DNS 和证书状态

正式域名暂定：

```text
birdora.birdai-glasses.com
```

DNS 目标：

```text
A 记录 -> 39.106.221.224
```

当前状态：

- 该域名尚未正确配置到目标服务器。
- 本地 DNS 检查曾解析到 `198.18.0.40`，不是目标 `39.106.221.224`。
- 独立 HTTPS 证书尚未申请。

要求：

- 先把 A 记录改到 `39.106.221.224`。
- DNS 生效后，先启用 Birdora 的 HTTP-only Nginx 配置，再用 webroot 方式为 `birdora.birdai-glasses.com` 单独申请 Let's Encrypt 证书。
- 不要复用或修改 `jewelry-api.birdai-glasses.com` 的证书和 Nginx server block。

## 5. Birdora 生产环境变量建议

Birdora 正式域名为 `https://birdora.birdai-glasses.com`：

```bash
export NODE_ENV=production
export NODE_INTERPRETER=/opt/node-v24/bin/node
export PORT=3003
export CORS_ORIGIN=https://birdora.birdai-glasses.com
export JWT_SECRET=<至少32位强随机密钥>
export JWT_EXPIRES_IN=7d
export JWT_COOKIE_NAME=birdora_token
export AUTH_RATE_LIMIT=30
export DATABASE_FILE=/var/lib/birdora/birdora.sqlite
export TRUST_PROXY=1
```

## 6. 上线前只读检查

进入服务器后，先执行这些检查，不改任何东西：

```bash
hostnamectl
pm2 list
ss -lntp | grep -E ':(80|443|3000|3002|3003|5432)\b'
nginx -T | grep -E 'server_name|3000|3002|3003|zhubao|birdora'
curl -I https://jewelry-api.birdai-glasses.com
```

预期：

- `birdora-api` 正常在线。
- `zhubao-api` 正常在线。
- `3000` 被现有 `birdora-api` 占用。
- `3002` 被现有珠宝后端占用。
- 首次部署时 `3003` 没有被占用；已上线后的复查中，`3003` 应由 `birdora-web-auth` 占用。
- `5432` 只在 `127.0.0.1` 监听。
- 珠宝 API 返回 `HTTP 200`。

## 7. Nginx 和证书顺序

证书申请前，先使用 HTTP-only 模板：

```text
deploy/nginx/birdora-pre-cert.conf
```

DNS 生效并且 HTTP-only 配置可访问后，使用 webroot 方式申请证书：

```bash
certbot certonly --webroot -w /var/www/birdora-web/public -d birdora.birdai-glasses.com
```

证书申请成功后，再使用最终 HTTPS 模板：

```text
deploy/nginx/birdora-https.conf
```

不要用 Certbot 自动改珠宝 API 的 Nginx 配置，也不要编辑 `jewelry-api.birdai-glasses.com` 的现有 server block。

最终 HTTPS 配置应等价于：

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

## 8. 上线后验收

Birdora 验收：

```bash
curl -I https://birdora.birdai-glasses.com/
curl -i https://birdora.birdai-glasses.com/api/health
curl -I https://birdora.birdai-glasses.com/server.js
curl -I https://birdora.birdai-glasses.com/app/data/birdora.sqlite
```

预期：

- 首页返回 `200`。
- `/api/health` 返回 `200`。
- `/server.js` 返回 `404`。
- `/app/data/birdora.sqlite` 返回 `404`。

珠宝服务回归：

```bash
curl -I https://jewelry-api.birdai-glasses.com
pm2 status birdora-api
pm2 status zhubao-api
```

预期：

- `birdora-api` 仍在线。
- 珠宝 API 仍返回 `HTTP 200`。
- `zhubao-api` 仍在线。
