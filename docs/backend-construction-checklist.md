# Birdora 后端施工清单

更新日期：2026-06-29

目标：先在本地把后端搭建、修复、接入和验证完成，再准备上传服务器。

## 1. 本地基础环境

- [x] 确认项目目录：`website/birdora-web`
- [x] 确认 Node.js、npm、pnpm 可用
- [x] 重建 `node_modules`
- [x] 确认 `node server.js` 可启动
- [x] 确认 `/api/health` 可访问
- [x] 确认后端核心 JS 语法检查通过
- [x] 确认 `pnpm audit --prod` 无已知漏洞
- [x] 补充 `.env` 本地加载方式，或明确只通过系统环境变量注入
- [x] 在 README 中补充后端启动说明

验收标准：

- `pnpm install --frozen-lockfile` 后可以启动后端
- `GET /api/health` 返回 `ok: true`
- 新接手人员能按文档在本地跑起来

## 2. 前后端认证接入

- [x] 在 `script.js` 增加认证 API 基础地址配置
- [x] 注册流程改为调用 `POST /api/auth/register`
- [x] 登录流程改为调用 `POST /api/auth/login`
- [x] 登出流程改为调用 `POST /api/auth/logout`
- [x] 页面初始化时调用 `GET /api/auth/status`
- [x] 受保护页面进入前调用后端确认登录态
- [x] 所有认证请求加入 `credentials: "include"`
- [x] 移除或降级旧的 `localStorage` 模拟账号逻辑
- [x] 统一前端错误提示，兼容后端 `{ message }` 返回格式
- [x] 验证刷新页面后仍保持登录态
- [x] 验证登出后不能访问受保护页面

验收标准：

- [x] 页面注册后，账号写入后端 SQLite
- [x] 页面登录后，浏览器收到 `HttpOnly` cookie
- [x] 刷新首页或社区页不会丢失登录态
- [x] 登出后本地登录态清除，后端登出接口调用成功

## 3. 后端安全加固

- [x] 生产环境强制要求 `JWT_SECRET`
- [x] 禁止生产环境使用示例密钥或默认密钥
- [x] 关闭 `X-Powered-By`
- [x] CORS 拒绝来源时返回 `403`，不要返回 `500`
- [x] 增加登录接口限流
- [x] 增加注册接口限流
- [x] 限制 JSON body 大小
- [x] 统一错误返回，生产环境避免暴露内部 500 错误细节
- [ ] 检查 cookie 配置是否适配生产域名和 HTTPS

验收标准：

- `NODE_ENV=production` 且无强密钥时服务拒绝启动
- 非白名单 Origin 请求返回明确拒绝
- 登录暴力尝试会被限流
- 响应头不暴露 Express

## 4. 数据存储方案

短期本地阶段：

- [x] 明确 `app/data/users.json` 只用于历史迁移
- [x] 明确 `app/data/revoked-tokens.json` 只用于历史迁移
- [x] 迁移认证数据到 SQLite
- [x] 避免测试脚本污染正式演示账号

上线前建议：

- [x] 决定数据库方案：SQLite
- [x] 设计 users 表
- [x] 设计 revoked_tokens 表
- [x] 编写数据迁移逻辑
- [x] 编写数据库初始化文档
- [x] 验证服务重启后数据保留
- [x] 验证并发注册不会覆盖数据

验收标准：

- 本地演示数据行为清楚
- [x] 上线方案不依赖 JSON 文件直接写入
- [x] 数据库初始化和迁移有文档

## 5. 测试与验证

- [x] 在 `package.json` 增加 `test:auth` 脚本
- [x] 改造 `scripts/test-auth.js`，支持独立测试账号
- [x] 增加健康检查测试
- [x] 增加注册成功测试
- [x] 增加重复邮箱注册测试
- [x] 增加登录成功测试
- [x] 增加登录失败测试
- [x] 增加 `/api/auth/me` 未登录返回 `401` 测试
- [x] 增加登出后 token 失效测试
- [x] 增加 CORS 白名单测试
- [x] 增加 CORS 非白名单测试

验收标准：

- 一条命令能跑完认证 API 冒烟测试
- 测试不会破坏已有演示数据
- 失败时能明确看到失败接口和原因

## 6. 文档补齐

- [x] 新增后端交接文档：`docs/backend-handoff.md`
- [x] 新增施工清单：`docs/backend-construction-checklist.md`
- [x] 更新 `docs/auth-api.md`，补充前端接入示例
- [x] 更新 `README.md`，加入前后端同时运行方式
- [x] 增加 `.env` 配置说明
- [x] 增加服务器部署说明
- [x] 增加 AI 鸟类识别交接文档
- [ ] 增加常见问题排查

验收标准：

- 新人能按 README 启动前端和后端
- 新人能按 API 文档接入认证
- 服务器部署前检查项完整

## 7. 上传服务器前准备

- [ ] 确认不上传 `node_modules`
- [ ] 确认 `.env` 不进入 Git
- [ ] 确认生产环境变量清单完整
- [ ] 确认服务器 Node.js 版本
- [ ] 确认服务器 pnpm 版本
- [ ] 确认实际部署路径
- [x] 记录同服务器已有服务，避免端口、目录、PM2 和 Nginx 冲突
- [x] 确认反向代理方案
- [x] 确认静态资源托管方案
- [x] 静态服务只托管 `public/`，不暴露项目根目录
- [x] 本地验证私有路径不会被静态服务访问
- [ ] 确认 HTTPS 证书实际路径
- [ ] 确认日志目录和日志轮转
- [x] 确认进程管理方案，例如 PM2 或 systemd
- [x] 确认备份方案

验收标准：

- 服务器可执行 `pnpm install --frozen-lockfile`
- `/api/health` 可从公网或内网访问
- 前端能正常调用生产 API
- 登录 cookie 在 HTTPS 下正常工作

## 8. 推荐施工顺序

1. 做本地完整验收。
2. 准备服务器部署脚本和反向代理配置。
3. 确认 SQLite 数据目录、权限和备份方案。
4. 上传服务器并做生产冒烟测试。

## 9. 当前优先级

本地下一步优先做：

- [x] `script.js` 接入后端登录/注册/登出
- [x] 页面初始化从 `/api/auth/status` 恢复登录态
- [x] 后端增加生产密钥校验
- [x] 修复 CORS 拒绝返回码
- [x] 更新 README 的本地运行方式
- [x] 增加登录/注册限流
- [x] 明确 `.env` 加载方案
- [x] 做浏览器级登录注册回归测试
- [x] 完成 P0：静态服务禁止暴露项目根目录和后端数据文件
