# Birdora 深度 Bug 审查台账

记录日期：2026-06-29

## 1. 审查范围

本轮以“Bug 收集”为目标，只读审查，不做修复。

审查范围：

- 手机端响应式布局
- 前端 JS 交互与状态流
- 登录注册认证后端
- 鸟类识别模型与图鉴数据
- 部署脚本、Nginx、PM2、生产隔离
- 性能、可访问性、SEO、跨浏览器风险
- 生产资源可访问性和私有文件暴露

已完成基础验证：

```text
pnpm test:auth   PASS
pnpm test:atlas  PASS
node --check     PASS
```

生产基础检查：

```text
https://birdora.birdai-glasses.com/                       200
https://birdora.birdai-glasses.com/api/health             200
https://birdora.birdai-glasses.com/server.js              404
https://birdora.birdai-glasses.com/app/data/birdora.sqlite 404
https://jewelry-api.birdai-glasses.com                    200
```

## 2. 总体结论

当前没有发现“生产站立即全站不可用”的 P0。

但存在多个 P1，优先级最高的是：

1. 认证服务不可用时，首页和社区页会整体跳登录页，静态内容和图鉴也不可看。已本地处理，待发布。
2. 模型输出 11000 维，但标签库只有 10964 条，代码静默截断 36 个输出类。运行时已本地处理，标签资料待补齐。
3. 部署脚本上线后不可重复执行，容易形成半部署状态。已本地处理，待服务器 Bash 复核和发布。
4. 认证后端仍把 JWT 返回给前端 JSON，削弱 HttpOnly cookie 的安全收益。已本地处理并补回归测试，待发布。
5. 移动端部分横向溢出被全局隐藏，真实布局问题容易被遮住。
6. 生产静态资源缺少明确缓存策略，大模型和大图重复加载成本高。已本地处理，待发布。

鸟类识别能力结论：

- 当前可以说“模型可返回 1000+ 鸟类标签候选”。
- 不能严谨宣称“已完整支持 1000 种准确识别”。
- 依据：`bird_info.json` 有 10964 条标签，浏览器实测可返回 Top 5；但富图鉴只有 11 种，候选补资料清单 100 种，没有 1000 种准确率评测，也没有离线/弱网保障。

## 3. P0

当前未确认生产立即阻断型 P0。

注意：审查时 `assets/vendor/ort-wasm.wasm` 和 `assets/vendor/ort-wasm-simd.wasm` 是错误文本文件，不是真 wasm。当前 ORT 版本在 Chromium 实测走 `ort-wasm-simd-threaded.mjs/.wasm`，所以没有直接阻断当前识别。本地工作区已在 2026-06-30 移除这两个坏文件，并补充 wasm 魔数校验；生产环境仍需发布后才会同步修复。

## 4. P1

### P1-01 认证服务不可用会让首页和社区整体不可达

状态：

```text
本地已处理；生产待发布。
```

2026-06-30 本地处理：

- 首页和社区页先初始化只读内容，再异步同步登录状态。
- 认证 API 断开时不再整页跳转到 `login.html`。
- 发布、评论、个人资料等写入/个人动作继续通过登录检查保护。
- 已用本地浏览器拦截 `/api/auth/status` 验证：首页、社区页仍可读。

位置：

```text
script.js:12
script.js:520
script.js:547
```

现象：

关闭或断开认证 API 后打开首页/社区页，`fetchAuthStatus()` 把网络失败当成未登录，`requireAuth()` 清本地状态并跳到 `login.html`。

影响：

- 首页上传识别、图鉴、设备模拟、社区预览都不会初始化。
- 只读内容也被认证服务绑死。
- 后端短暂抖动会把用户踢出。

建议：

- 区分“未登录”和“认证服务不可达”。
- 首页不要整体放进强认证页面，只保护发布、评论、我的帖子等写入/个人功能。
- API 不可用时给只读降级页和明确错误提示。

### P1-02 模型输出维度和标签库不一致

状态：

```text
运行时静默截断已修复；标签资料仍待补齐。
```

2026-06-30 本地处理：

- `topOseaCandidates()` 改为遍历完整模型输出维度，而不是 `Math.min(logits.length, birdInfo.length)`。
- 缺少标签映射的输出类会显示为 `未映射 OSEA 输出标签 N`，并参与 Top 5 排序和 softmax 概率计算。
- 识别结果文案会说明模型输出维度、已映射标签数和待补映射数量。
- 浏览器人造 logits 验证：第 11000 类可作为 `未映射 OSEA 输出标签 11000` 返回，概率正常。

位置：

```text
script.js:1047
assets/osea/bird_info.json
assets/osea/bird_model.onnx
```

证据：

```text
模型输出维度：11000
标签库数量：10964
缺口：36
```

当前代码用 `Math.min(logits.length, birdInfo.length)` 静默截断。

影响：

- 如果真实 Top1 落在缺失的 36 类里，会被忽略。
- 剩余候选可能被错误排序，置信度也可能显得偏高。
- 测试脚本没有检查 ONNX 输出维度。

建议：

- 补齐 11000 条标签，或明确映射缺失类别。
- 启动时校验模型输出维度等于标签数量。
- `scripts/validate-atlas-data.js` 增加模型输出维度检查。

### P1-03 首次识别弱网体验风险高

状态：

```text
本地已处理基础韧性；生产待发布。仍建议后续补真实下载进度条和 CDN/缓存策略。
```

2026-06-30 本地处理：

- 识别流程增加阶段提示：读图、加载标签库、准备模型、预处理照片、运行模型、整理 Top 5。
- OSEA 模型加载增加 60 秒超时，标签库加载增加 15 秒超时。
- 模型/标签加载失败会清空对应 Promise，重新选择照片可再次尝试。
- 失败提示区分 `file://` 打开和网络/资源不可达。
- 已用 390px 手机视口跑 `index.html?selftest`：识别返回翠鸟，Top 候选 5 条，无横向溢出，无控制台错误。

位置：

```text
script.js:935
script.js:952
assets/vendor/
assets/osea/bird_model.onnx
```

现象：

首次识别需要加载：

```text
ONNX Runtime JS：约 446 KB
WASM：约 10.7 MB
ONNX 模型：约 27.2 MB
标签 JSON：约 0.7 MB
```

影响：

- 移动弱网下会长时间停在“正在加载/运行模型”。
- 无下载进度、无超时、无重试、无断点。
- 失败后用户只能猜。

建议：

- 增加模型资源预加载状态和进度说明。
- 加载失败后清空 Promise，允许重试。
- 对模型和 WASM 设置长缓存。
- 考虑轻量服务端识别或分阶段加载。

### P1-04 ORT vendor 目录存在坏 wasm 文件

状态：

```text
本地已处理，生产待发布。
```

2026-06-30 本地处理：

- 从 `onnxruntime-web@1.20.1` npm 包校准 `ort.min.js`、`ort-wasm-simd-threaded.mjs`、`ort-wasm-simd-threaded.wasm`。
- 删除 `assets/vendor/ort-wasm.wasm` 和 `assets/vendor/ort-wasm-simd.wasm`。
- 同步删除 `public/assets/vendor/ort-wasm.wasm` 和 `public/assets/vendor/ort-wasm-simd.wasm`。
- `scripts/validate-atlas-data.js` 增加 wasm 魔数校验和 stale ORT fallback 文件检查。
- `pnpm test:atlas` 当前结果为 `0 errors, 1 warning`，warning 为模型输出 11000 维与标签库 10964 条的既有缺口。

位置：

```text
assets/vendor/ort-wasm.wasm
assets/vendor/ort-wasm-simd.wasm
public/assets/vendor/ort-wasm.wasm
public/assets/vendor/ort-wasm-simd.wasm
```

证据：

文件内容是：

```text
Couldn't find the requested file /dist/ort-wasm.wasm in onnxruntime-web.
Couldn't find the requested file /dist/ort-wasm-simd.wasm in onnxruntime-web.
```

影响：

- 当前 Chromium 路径实测不依赖它们，但 fallback、升级、其他浏览器或配置变化时可能直接炸识别。
- 排障时容易被误导。

建议：

- 用同版本 `onnxruntime-web` 的完整 dist 文件替换 vendor。
- 明确记录当前 ORT 版本和所需文件清单。
- 加资源完整性检查：wasm 文件必须以 `00 61 73 6d` 魔数开头。

### P1-05 认证返回 JWT 给前端 JSON

状态：

```text
本地已处理；生产待发布。
```

2026-06-30 本地处理：

- `register()` 和 `login()` 只通过 HttpOnly cookie 建立登录态。
- JSON 响应只保留 `message` 和脱敏后的 `user`。
- `scripts/test-auth.js` 已补回归检查：注册/登录 JSON 不允许出现 `token`、`expiresIn`、`expiresAt`、`jti`。

位置：

```text
app/controllers/auth.controller.js:93
app/controllers/auth.controller.js:125
```

现象：

注册/登录同时设置 HttpOnly cookie，又在 JSON 响应中返回 JWT。

影响：

- XSS、调试工具、日志都可能拿到 bearer token。
- 削弱 HttpOnly cookie 的意义。

建议：

- Web 端改为 cookie-only。
- 如果保留 API bearer token，拆成显式 API token 模式并缩短有效期。

### P1-06 生产安全依赖 NODE_ENV

状态：

```text
本地已处理；生产待发布。
```

2026-06-30 本地处理：

- `auth.config.js` 已按生产形态识别强制校验 `JWT_SECRET`，不只依赖 `NODE_ENV`。
- `server.js` 已按正式 HTTPS 来源、生产数据路径、3003 端口识别生产形态。
- 生产形态缺少 `CORS_ORIGIN` 会拒绝启动。
- 已本地模拟验证：弱 `JWT_SECRET` 和缺失 `CORS_ORIGIN` 都会启动失败。

位置：

```text
server.js:11
app/config/auth.config.js:1
```

现象：

如果生产直接 `node server.js` 且漏设 `NODE_ENV=production`，会启用开发默认密钥、非 Secure cookie，并跳过生产 CORS 强校验。

影响：

- JWT 可被伪造。
- Cookie 安全策略失效。

建议：

- 生产启动强制要求真实 `JWT_SECRET`。
- Cookie `secure` 不只依赖 `NODE_ENV`，结合 HTTPS/部署配置显式校验。

### P1-07 状态接口读请求会触发 SQLite 写操作

状态：

```text
本地已处理；生产待发布。
```

2026-06-30 本地处理：

- `isTokenRevoked()` 已改为只读查询，不再触发过期 token 清理。
- 清理过期撤销 token 保留在登出/撤销路径，避免 `/me`、`/status` 高频读请求写库。
- `PRAGMA busy_timeout = 5000` 已在 SQLite 初始化中存在。

位置：

```text
app/middleware/auth-jwt.js:27
app/services/token.service.js:3
app/db/database.js:81
```

现象：

每次 `/me`、`/status` 鉴权都会清理撤销 token，读接口触发 SQLite 写入。

影响：

- 高频状态检查可能写锁竞争。
- 同步 SQLite 会阻塞 Node 事件循环。
- 多进程部署更危险。

建议：

- 清理任务改为启动时/定时/带节流。
- 加 `PRAGMA busy_timeout`。
- 状态接口保持只读。

### P1-08 认证异常被吞成未登录

状态：

```text
当前代码已处理；生产待发布。
```

2026-06-30 核验：

- `resolveAuthSession()` 只把 JWT 格式错误、过期、未生效视为未登录。
- 数据库、服务层等非 JWT 异常会继续抛给 Express 错误处理中间件，不再伪装成 401。

位置：

```text
app/middleware/auth-jwt.js:26
```

现象：

JWT、数据库、服务层异常都被统一捕获并返回未认证。

影响：

- SQLite 损坏、锁错误会伪装成 401。
- 线上故障难发现，用户被误踢。

建议：

- 只吞 `JsonWebTokenError` / `TokenExpiredError`。
- 数据库和程序错误进入全局错误处理并记录日志。

### P1-09 部署脚本上线后不可重复执行

状态：

```text
本地已处理；生产待发布。Bash 语法需在服务器执行 bash -n 复核。
```

2026-06-30 本地处理：

- `install-http.sh` 已将 3003 端口占用检查前置。
- 已支持已有 `birdora-web-auth` 时重启，而不是直接失败。
- PM2 启动后增加 `/api/health` 等待循环；失败时输出 PM2 日志。
- HTTP 阶段 Nginx 安装前会先备份旧配置，配置测试失败会回滚。

位置：

```text
deploy/scripts/install-http.sh:44
deploy/scripts/install-http.sh:59
```

现象：

脚本先安装依赖、同步 public、改权限，然后才检查 3003 端口是否占用。生产已上线后再跑，会在端口检查处退出。

影响：

- 可能出现“前端已更新、PM2 后端未重启”的半部署。

建议：

- 把端口/服务状态检查前置。
- 拆分首次安装脚本和增量发布脚本。
- 增加 release 目录和原子 symlink 切换。

### P1-10 PM2 save 可能影响旧服务恢复清单

状态：

```text
本地已处理；生产待发布。
```

2026-06-30 本地处理：

- `pm2 save` 前强制检查当前 PM2 用户能看到 `birdora-api`、`zhubao-api` 和 `birdora-web-auth`。
- 如果旧服务不在当前 PM2 清单里，脚本会停止，避免覆盖错误用户的 resurrect 列表。

位置：

```text
deploy/scripts/install-http.sh:64
deploy/scripts/install-http.sh:65
```

现象：

脚本直接 `pm2 start` 后全局 `pm2 save`，没有校验当前 PM2 用户和旧服务所属用户一致。

影响：

如果在错误用户上下文运行，可能保存不含旧服务的 resurrect 列表，重启后影响旧服务。

建议：

- 固定 `PM2_HOME` 或校验当前 PM2 清单包含旧服务。
- `pm2 save` 前确认 `birdora-api`、`zhubao-api` 都在当前 PM2 用户下。

### P1-11 Nginx 替换没有备份和失败回滚

状态：

```text
本地已处理；生产待发布。Bash 语法需在服务器执行 bash -n 复核。
```

2026-06-30 本地处理：

- `install-http.sh` 和 `enable-https.sh` 都增加 Birdora Nginx 配置备份。
- `nginx -t` 失败时恢复上一版配置；首次创建的 enabled symlink 也会回滚。
- HTTPS 切换后会等待正式站点可访问，再检查 `/api/health` 和 `jewelry-api`。

位置：

```text
deploy/scripts/install-http.sh:68
deploy/scripts/enable-https.sh:21
```

现象：

脚本覆盖 `/etc/nginx/sites-available/...` 后才 `nginx -t`。

影响：

如果模板错误，坏配置会留在 sites-available，后续 reload 都可能受影响。

建议：

- 覆盖前自动备份。
- `nginx -t` 失败时恢复上一版。
- 生成临时文件测试通过后再原子替换。

### P1-12 生产静态缓存策略不足

状态：

```text
本地已处理；生产待发布。
```

2026-06-30 本地处理：

- Nginx 中 `/assets/` 下图片、WASM、ONNX 设置 `public, max-age=31536000, immutable`。
- HTML/CSS/JS/MJS 和 JSON 设置 `no-cache, must-revalidate`。
- 根路径 `/` 明确返回 `index.html` 并设置 no-cache，降低发版缓存错配风险。

位置：

```text
deploy/nginx/birdora-https.conf:34
scripts/static-server.js:76
```

现象：

本地静态服务器区分 JSON/no-cache、assets/immutable，但生产 Nginx 只给 JSON no-cache。HTML、CSS、JS、大模型和图片没有明确缓存策略。

影响：

- 大资源重复下载。
- 未来发版可能遇到旧前端缓存。

建议：

- 给 `/assets/` 设置 `Cache-Control: public, max-age=31536000, immutable`。
- 给 HTML/CSS/JS 设置明确 no-cache 或引入文件 hash。
- JSON 根据更新频率单独控制。

### P1-13 私有文件防护缺少扩展名兜底

状态：

```text
本地已处理；生产待发布。
```

2026-06-30 本地处理：

- Nginx 已增加 `.sqlite`、`.db`、`.bak`、`.env`、`.pem`、`.key`、`.log`、`.sql`、压缩包等敏感扩展名拒绝。
- `scripts/sync-public.js` 已增加 assets 同步 denylist，发布目录不会复制这些敏感文件。

位置：

```text
deploy/nginx/birdora-https.conf:17
scripts/sync-public.js:45
```

现象：

Nginx 只拦 `/app`、`/docs`、`/scripts`、`/.git` 和少数根文件；`sync-public.js` 会递归复制整个 `assets/`。

影响：

未来如果误把 `.sqlite`、`.db`、`.bak`、密钥文件放入 `assets/`，会被公开。

建议：

- Nginx 增加敏感扩展名拒绝。
- `sync-public.js` 增加 allowlist 或 denylist。
- 发布前加资源安全扫描。

### P1-14 移动端横向溢出被全局隐藏

状态：

```text
本地已处理；生产待发布。
```

2026-06-30 本地处理：

- 移除 `html, body { overflow-x: hidden; }` 的全局横向隐藏。
- `main` 不再裁剪横向内容，页面级溢出会在 QA 中暴露。
- 跑马灯仍由 `.bird-grid.is-marquee` 局部控制滚动/裁剪。
- 已用 390px 手机视口和桌面视口检查首页、社区页、登录页：页面 scrollWidth 均等于 viewport width，无控制台错误。

位置：

```text
styles.css:2966
index.html:109
```

现象：

`html, body { overflow-x: hidden; }`、`main { overflow-x: clip; }` 掩盖真实横向溢出。图鉴跑马灯内部元素可超出视口很多。

影响：

- QA 不容易发现真实溢出。
- 离屏卡片里的链接/按钮可能可聚焦但不可见。

建议：

- 不要用页面级横向隐藏兜底。
- 把裁切限制到 `.bird-grid`/跑马灯容器。
- 处理离屏卡片可聚焦状态。

## 5. P2

### P2-01 登录后丢失原始 hash/目标页

位置：

```text
script.js:552
script.js:907
script.js:924
```

未登录访问 `index.html#device` 或 `index.html#community`，登录后总是回首页顶部。

建议：跳登录时带 `next`，登录成功后校验同源路径并回跳。

### P2-02 发布后进入社区默认看不到自己的帖子

位置：

```text
index.html:138
community.html:38
script.js:674
```

首页发布后点“更多”，如果社区 tab 仍为“推荐”，新帖不显示。

建议：发布后切到 `mine`，或社区默认展示全部并把我的帖子置顶。

### P2-03 localStorage 异常会中断页面或卡住 UI

位置：

```text
script.js:588
script.js:593
script.js:1804
script.js:1814
```

风险：

- `birdora-user-posts` 不是数组时会 `filter is not a function`。
- localStorage 禁用/满了时设备连接模拟可能卡在“连接中”。

建议：

- 读取后做 `Array.isArray` 校验。
- 所有持久化写入包 `try/catch`。

### P2-04 模型/标签加载失败后页面内无法重试

位置：

```text
script.js:953
script.js:970
script.js:1210
```

失败的 Promise 会被缓存，恢复网络后也需要刷新页面才可能恢复。

建议：只缓存成功结果，失败时清空 Promise；UI 增加“重试”。

### P2-05 社区页无识别入口但加载 ORT

位置：

```text
community.html:52
```

社区页仍加载 `ort.min.js`，增加约 446 KB 下载和解析。

建议：只在首页识别模块需要时加载 ORT。

### P2-06 表单缺少显式 label/aria-label

位置：

```text
index.html:116
index.html:130
index.html:131
script.js:653
```

搜索、发帖标题、正文、动态评论输入依赖 placeholder。

建议：加可见 label 或视觉隐藏 label。

### P2-07 社区 tab ARIA 不完整

位置：

```text
community.html:39
script.js:767
```

`role="tablist"` 下按钮缺 `role="tab"`、`aria-controls`、tabpanel 和方向键交互。

建议：补完整 tab 模式，或去掉 tablist 按普通分段按钮实现。

### P2-08 SEO 和分享信息不足

位置：

```text
index.html:4
community.html:4
login.html:4
```

缺 description、canonical、OG/Twitter、theme-color；登录/条款页面未明确 robots 策略。

建议：首页和社区补 SEO/social meta；登录和协议按目标设置 noindex/canonical。

### P2-09 图片资源未做移动端优化

位置：

```text
index.html:157
styles.css:299
assets/hero-birdora.png
assets/device-glasses-cutout.png
```

大 PNG 直接加载：

```text
hero-birdora.png             约 2.1 MB
device-glasses-cutout.png    约 1.0 MB
```

建议：

- 生成 WebP/AVIF 和小屏版本。
- 设备图补 `width`、`height`、`loading="lazy"`、`decoding="async"`。

### P2-10 CSS 断点和后写规则互相覆盖

位置：

```text
styles.css:1635
styles.css:3073
styles.css:2232
styles.css:2353
```

现象：

- 早期 920px 隐藏导航，后续 768-920px 又显示导航。
- `.result-card` 先压缩高度，后面又全局取消。

建议：

- 合并响应式规则。
- 明确桌面、平板、手机三套断点。
- 减少“最终修正”式后写覆盖。

### P2-11 移动端上传缺少文件保护

位置：

```text
index.html:76
script.js:1585
```

只有 `accept="image/*"`，没有大小限制、HEIC/超大图兜底、capture 提示。

建议：

- 加文件大小和 MIME 检查。
- 对图片解码失败给明确提示。
- 根据产品需要考虑 `capture="environment"`。

### P2-12 证书续期缺少验证记录

位置：

```text
deploy/scripts/enable-https.sh:19
docs/production-launch-report-20260629.md:57
```

当前记录了证书到期日 `2026-09-27`，但没有记录 `certbot renew --dry-run` 和 Nginx reload hook。

建议：

- 补一次 dry-run。
- 记录续期后 Nginx reload/健康检查。

### P2-13 备份/回滚不保证 SQLite 一致性

位置：

```text
docs/production-launch-report-20260629.md:142
docs/deployment.md:265
```

直接复制 `/var/lib/birdora` 可能拿到不一致 WAL 状态。

建议：

- 使用 SQLite `.backup` 或短暂停服务备份。
- 回滚时同步前端、后端、Nginx root 和数据库版本。

## 6. 建议施工顺序

第一批：核心功能和生产风险

1. 修复模型输出维度与标签数量不一致。
2. 替换错误 wasm 文件，补资源完整性检查。
3. 首页解除强认证依赖，只保护写入/个人功能。
4. 认证后端去掉 JSON JWT 返回，改 cookie-only。
5. 部署脚本拆分首次安装和增量发布，避免半部署。

第二批：移动端和体验

1. 清理 CSS 断点覆盖顺序。
2. 修复图鉴跑马灯横向溢出隐藏问题。
3. 优化识别结果卡和社区顶栏手机表现。
4. 加模型加载进度、失败重试。
5. 加文件上传保护和清晰错误提示。

第三批：运维、性能、可访问性

1. Nginx 增加缓存策略和敏感扩展名拦截。
2. 增加 SQLite 一致性备份方案。
3. 补 SEO/social meta。
4. 补表单 label、tab ARIA、图片尺寸和 lazy loading。

## 7. 可拆线程建议

建议拆成 5 个线程：

1. 识别模型资源线程：ONNX 维度、标签补齐、WASM 文件、模型加载重试。
2. 认证安全线程：cookie-only、异常处理、SQLite busy_timeout、状态接口只读。
3. 手机端 CSS 线程：断点整理、横向溢出、顶部栏、识别结果卡、社区。
4. 部署运维线程：增量发布脚本、Nginx 缓存、备份、证书续期 dry-run。
5. 可访问性/SEO/性能线程：label、ARIA、meta、大图格式、懒加载。
