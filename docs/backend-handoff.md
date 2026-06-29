# Birdora 后端分析与交接文档

更新日期：2026-06-29

## 1. 当前结论

Birdora 当前是“静态前端 + Express 认证 API”的混合项目。后端认证服务已经具备注册、登录、登出、当前用户和登录状态检查接口；认证数据当前存储在 SQLite 数据库中。

本轮已修复本地依赖链接损坏问题：原 `node_modules` 是从旧路径迁移过来的，缺少顶层依赖链接，导致 `node server.js` 报 `Cannot find module 'express'`。已删除并用 `pnpm install --frozen-lockfile` 重建 `node_modules`，现在后端可以启动。

当前已完成前端认证接入：登录、注册、登出和页面登录态恢复会调用后端 `/api/auth/*` 接口。`localStorage` 只保留前端展示所需的当前用户摘要，不再保存模拟账号或明文密码。

## 2. 技术栈

- Runtime：Node.js `>=24.14.0`
- Web 框架：Express
- 鉴权：JWT
- 密码哈希：bcryptjs
- 跨域：cors
- Cookie：cookie-parser
- 数据存储：SQLite
- 环境变量：dotenv
- 登录限流：express-rate-limit
- 包管理：pnpm

关键依赖见 `package.json`：

- `express`
- `cors`
- `cookie-parser`
- `dotenv`
- `jsonwebtoken`
- `bcryptjs`
- `express-rate-limit`

## 3. 目录结构

```text
server.js
public/
  index.html
  script.js
  styles.css
  assets/
app/
  config/
    auth.config.js
  controllers/
    auth.controller.js
  data/
    birdora.sqlite
  db/
    database.js
  middleware/
    auth-jwt.js
  routes/
    auth.routes.js
  services/
    token.service.js
    user.service.js
docs/
  auth-api.md
  backend-handoff.md
  bird-recognition-handoff.md
  deployment.md
scripts/
  static-server.js
  sync-public.js
  test-auth.js
```

## 4. 后端启动流程

入口文件是 `server.js`。

启动后会做这些事：

1. 读取 `PORT`，默认 `4000`。
2. 读取 `CORS_ORIGIN`，默认 `http://localhost:4174`。
3. 启用 CORS，并允许携带 cookie。
4. 启用 JSON body、URL encoded body 和 cookie 解析。
5. 注册 `GET /api/health`。
6. 将认证路由挂载到 `/api/auth`。
7. 注册统一错误返回；生产环境下 500 错误不会把内部错误信息原样返回。

本地启动：

```bash
pnpm install
pnpm start
```

开发启动：

```bash
pnpm dev
```

前端静态服务仍需单独启动，必须只托管 `public/`：

```bash
pnpm start:web
```

然后访问：

```text
http://localhost:4174
```

后端 API 默认访问：

```text
http://localhost:4000
```

## 5. 环境变量

`.env.example` 当前包含：

```text
PORT=4000
CORS_ORIGIN=http://localhost:4174,http://127.0.0.1:4174
JWT_SECRET=replace-with-at-least-32-random-characters
JWT_EXPIRES_IN=7d
JWT_COOKIE_NAME=birdora_token
AUTH_RATE_LIMIT=30
DATABASE_FILE=app/data/birdora.sqlite
TRUST_PROXY=0
```

后端会在启动时加载 `.env` 文件。生产环境也可以通过进程管理器或服务器环境显式注入环境变量。

生产环境必须设置强随机 `JWT_SECRET`，不能使用默认值。
生产环境必须将 `CORS_ORIGIN` 设置为真实前端域名，例如 `https://example.com`。
如果后端在 Nginx 后面运行，生产环境建议设置 `TRUST_PROXY=1`，让限流和真实客户端 IP 判断更准确。

## 6. API 清单

### 健康检查

`GET /api/health`

返回：

```json
{
  "ok": true,
  "service": "birdora-auth-api",
  "timestamp": "2026-06-29T02:04:09.848Z"
}
```

### 注册

`POST /api/auth/register`

请求：

```json
{
  "email": "bird@example.com",
  "password": "secret123",
  "nickname": "Bird Fan"
}
```

成功返回 `201`，并返回 JWT，同时设置 `HttpOnly` cookie。

### 登录

`POST /api/auth/login`

请求：

```json
{
  "email": "bird@example.com",
  "password": "secret123"
}
```

成功返回 `200`，并返回 JWT，同时设置 `HttpOnly` cookie。

### 登出

`POST /api/auth/logout`

支持从 `Authorization: Bearer <token>` 或认证 cookie 读取当前 token。若 token 有效，会将其 `jti` 写入撤销列表。

### 当前用户

`GET /api/auth/me`

需要认证。未认证返回 `401`。

### 登录状态

`GET /api/auth/status`

不强制登录。未登录返回：

```json
{
  "authenticated": false,
  "user": null
}
```

## 7. 鉴权机制

后端支持两种认证方式：

1. `Authorization: Bearer <token>`
2. `HttpOnly` cookie，默认名为 `birdora_token`

JWT payload 当前包含：

- `email`
- `nickname`
- `jti`
- `sub`：用户 ID
- `iat`
- `exp`

登出时会将当前 JWT 的 `jti` 写入 SQLite 的 `revoked_tokens` 表。后续请求会检查 token 是否已撤销。

## 8. 数据存储

当前用户和撤销 token 写入 SQLite：

```text
app/data/birdora.sqlite
```

启动时会自动建表。如果旧 JSON 文件存在，会自动导入历史数据：

- `app/data/users.json`
- `app/data/revoked-tokens.json`

SQLite 适合单机部署。若后续要多实例、多人高并发或云数据库托管，建议再迁移到 PostgreSQL 或 MySQL。

## 9. 前后端接入状态

当前前端已接入后端认证。

前端登录注册逻辑位于 `script.js`：

- 注册时调用 `POST /api/auth/register`
- 登录时调用 `POST /api/auth/login`
- 登出时调用 `POST /api/auth/logout`
- 登录页和受保护页面初始化时调用 `GET /api/auth/status`
- 认证请求使用 `credentials: "include"`，让浏览器保存和携带 `HttpOnly` cookie
- `localStorage` 只保存 `birdoraLoggedIn` 和 `birdora-auth-user` 作为前端展示缓存

还需要继续验证：

1. 后端未启动时登录页提示是否符合预期。
2. 生产域名下 cookie、CORS 和反向代理是否匹配。
3. 旧浏览器中 `fetch` 与 cookie 行为是否满足目标用户环境。

## 10. 本轮验证结果

已通过：

- `node --check server.js`
- `node --check script.js`
- `node --check app/config/auth.config.js`
- `node --check app/controllers/auth.controller.js`
- `node --check app/middleware/auth-jwt.js`
- `node --check app/routes/auth.routes.js`
- `node --check app/services/token.service.js`
- `node --check app/services/user.service.js`
- `node --check app/db/database.js`
- `node --check scripts/static-server.js`
- `node --check scripts/sync-public.js`
- `node --check scripts/test-auth.js`
- `pnpm audit --prod`：未发现已知漏洞
- `pnpm test:auth`：认证接口注册、登录、cookie、登出、撤销 token 全链路通过

API 冒烟测试通过：

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- 浏览器注册流程：`http://127.0.0.1:4174/login.html` 调用 `POST /api/auth/register` 返回 `201`

测试环境：

- Node.js：`v25.2.1`
- npm：`11.6.2`
- pnpm：`11.7.0`

## 11. 已确认问题与风险

### 已完成：前端接入后端认证

当前状态：注册、登录、登出和登录态恢复已统一使用后端 API。

后续建议：继续做浏览器级回归测试，确认所有页面跳转和提示文案符合预期。

### P0：迁移后的 `node_modules` 曾不可用

影响：`node server.js` 无法启动，错误为 `Cannot find module 'express'`。

当前状态：已重建依赖目录，后端可启动。

处理建议：交付和上传服务器时不要上传本地 `node_modules`，服务器上使用 `pnpm install --frozen-lockfile` 重新安装。

### 已完成：生产环境密钥强制校验

当前状态：当 `NODE_ENV=production` 且 `JWT_SECRET` 为空、为示例值或长度不足时，服务会拒绝启动。

位置：`app/config/auth.config.js`

### 已完成：认证数据迁移到 SQLite

当前状态：用户和撤销 token 已写入 `app/data/birdora.sqlite`。旧 JSON 数据已经迁移并从本地项目目录删除；以后若迁移文件存在，启动时仍会自动导入。

位置：`app/db/database.js`、`app/services/user.service.js`、`app/services/token.service.js`

后续建议：上线时把数据库文件放到可备份的数据目录，并确保不会被静态服务暴露。

### 已完成：CORS 拒绝来源返回 403

当前状态：非白名单 Origin 会返回 `403`。

位置：`server.js`

### 已完成：关闭 `X-Powered-By`

当前状态：启动时调用 `app.disable("x-powered-by")`。

位置：`server.js`

### 已完成：登录和注册请求限流

当前状态：`POST /api/auth/login` 和 `POST /api/auth/register` 已加入 15 分钟窗口限流，默认每个来源 30 次，可用 `AUTH_RATE_LIMIT` 调整。

位置：`app/routes/auth.routes.js`

### 已完成：静态服务只暴露 public 目录

当前状态：本地静态服务通过 `scripts/static-server.js` 只托管 `public/`，不会暴露 `app/`、`docs/`、`server.js`、`package.json` 等项目私有文件。

上线要求：Nginx root 必须指向 `public/`，不要把项目根目录作为静态目录。

### 已完成：补充认证测试脚本入口

当前状态：`package.json` 已增加 `test:auth`。

后续建议：让脚本支持非破坏性测试账号，避免污染正式演示数据。

## 12. 本地后端修复优先级

建议按这个顺序推进：

1. 准备服务器部署和反向代理配置。
2. 确认 SQLite 数据目录、备份和权限。
3. 做生产域名 HTTPS 下的完整登录注册验收。

## 13. 上传服务器前检查清单

服务器准备：

- 安装 Node.js LTS。
- 安装 pnpm。
- 上传源码，不上传 `node_modules`。
- 执行 `pnpm install --frozen-lockfile`。
- 设置 `NODE_ENV=production`。
- 设置强随机 `JWT_SECRET`。
- 设置正确的 `PORT`。
- 设置生产域名对应的 `CORS_ORIGIN`。

反向代理：

- 将 `/api/` 转发到 Node 后端端口。
- 静态 HTML/CSS/JS/assets 只从 `public/` 目录提供。
- 禁止把项目根目录作为静态根目录，避免暴露 `app/`、`docs/`、`server.js`、`package.json` 等私有文件。
- 如果前后端不同域，需要确认 cookie 的 `sameSite` 和 `secure` 策略。

上线前验证：

- `GET /api/health`
- 注册新账号
- 登录
- 刷新页面保持登录态
- 访问受保护页面
- 登出后无法访问 `/api/auth/me`
- 检查服务重启后用户数据是否保留
