# Birdora 本地全量审计与维护交接（2026-07-19）

## 1. 范围与安全边界

- 工作分支：`feature/v1.7.0-front-plus`
- 本轮仅修改本地工作树并使用隔离 SQLite 测试库；未连接、修改或迁移生产数据库。
- 本轮未执行生产发布、服务器重启、Git 提交或远端推送。
- 本轮没有新增数据库迁移，现有生产数据结构不受影响。

## 2. 已完成修复

### 前端与社区页

- 为社区推荐、发布、消息、个人四个视图建立统一的字体角色、圆角、间距、表面和控件尺寸规则。
- 统一页面标题、说明、卡片标题、正文和辅助信息的视觉层级；修复个人页统计卡和内容卡在窄屏下的拥挤与错位。
- 社区顶部视图导航改为可横向滑动的 44px 胶囊控件，并自动让当前项进入可视区。
- 修复移动端主导航缺失、识别页操作按钮异常放大、卡片网格溢出等问题。
- 核心页面保持唯一 `h1`，主要按钮和选择器触控高度不低于 44px；桌面和手机复测均无横向溢出。
- 登录/注册互跳会保留同源 `next` 参数，同时拒绝外部跳转地址。
- 仅在真实识别页面加载 ONNX 浏览器运行时，减少社区、个人和设备页的无关负担。

### 后端与安全

- 登录用户不存在时仍执行同成本密码比较，降低通过响应时间枚举账户的风险。
- 未匹配的 `/api/*` 路由统一返回带 `requestId` 的 JSON 404；通用错误不再暴露内部错误类名。
- 日志脱敏覆盖图片/视频 Data URL、头像、位置和凭据字段。
- 为服务端鸟类识别增加有界并发队列、排队上限和超时；过载时稳定返回 `RECOGNITION_BUSY` 或 `RECOGNITION_QUEUE_TIMEOUT`。
- JPEG 解码增加 24MP 像素上限，降低压缩炸弹和内存峰值风险。
- 补齐认证、发帖、观察和识别接口限流错误的稳定 `RATE_LIMITED` 代码。
- 示例环境文件与生产环境校验脚本同步新增识别队列参数。

## 3. 验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 通过，退出码 0 |
| `pnpm audit --prod` | 无已知漏洞 |
| `git diff --check` | 通过 |
| 前端契约测试 | 12 项通过 |
| Phase 0 后端测试 | 通过 |
| 识别队列测试 | 通过 |
| 服务端真实模型识别 | 通过，Kingfisher Top 1，11000 类输出 |
| 桌面/手机浏览器复核 | 社区四视图与识别页无横向溢出；核心触控控件不小于 44px |

全量测试日志保存在：
`C:/Users/Administrator/Documents/逸轩_开发/.birdora-audit/2026-07-19/full-test-final.log`

## 4. 视觉对比证据

- 移动端识别页：`C:/Users/Administrator/Documents/逸轩_开发/.birdora-audit/2026-07-19/screenshots/comparison-explore-mobile-before-after.jpg`
- 移动端社区推荐：`C:/Users/Administrator/Documents/逸轩_开发/.birdora-audit/2026-07-19/screenshots/comparison-community-recommended-mobile-typography.jpg`
- 移动端社区发布：`C:/Users/Administrator/Documents/逸轩_开发/.birdora-audit/2026-07-19/screenshots/comparison-community-publish-mobile-typography.jpg`
- 移动端个人页：`C:/Users/Administrator/Documents/逸轩_开发/.birdora-audit/2026-07-19/screenshots/comparison-personal-mobile-before-after.jpg`
- 桌面端社区个人页：`C:/Users/Administrator/Documents/逸轩_开发/.birdora-audit/2026-07-19/screenshots/comparison-community-personal-desktop-typography.jpg`

## 5. 暂缓直接热更的事项

以下项目需要兼容性迁移或灰度验证，不应和本轮视觉修复一起直接灌入生产：

1. JWT 增加 `issuer` / `audience`：直接启用会使现有登录会话失效，需要双读兼容期和回滚方案。
2. CSP：先以 Report-Only 采集模型、Worker、图片和外部资源实际来源，再逐步收紧。
3. 签名 CSRF 令牌：当前已有精确来源校验和 `SameSite=Lax`，升级前需覆盖所有写接口及旧客户端。
4. 头像/媒体解码重编码与 EXIF 清理：需要独立媒体处理管线、容量评估和历史资源兼容策略。
5. `script.js` 体积较大且存在重复函数声明；应按认证、社区、识别、用户模块逐步拆分，并保持现有全量回归测试护栏。
6. `bcryptjs`、Express 等大版本升级应单独建分支验证，不与生产热更新混发。

## 6. 后续维护与上线顺序

1. 将本地变更审阅、提交并推送到 `feature/v1.7.0-front-plus`，不要纳入无关的 `.codex-release/` 目录。
2. 在和生产同版本 Node 的隔离环境重新执行 `pnpm test`、`pnpm audit --prod` 和发布清单校验。
3. 上线前执行数据库只读预检与备份；本轮不需要数据库迁移。
4. 采用可回滚发布目录和原子指针切换，先健康检查再放量；不要覆盖正在运行的数据库文件。
5. 验证登录、注册、识别、社区发帖、点赞、评论、关注、消息、个人页和私有媒体权限后，再完成流量切换。
6. 保留上一版本、数据库备份、发布清单和回滚命令，观察错误率、识别队列饱和度及 401/429/5xx 指标。
