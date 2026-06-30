# Birdora 稳定版修理总施工文稿

记录日期：2026-06-30

用途：给总线程、后续施工线程、验收线程共同使用。每个新线程开工前先读本文，再读对应专项文档。

## 1. 总目标

Birdora 当前已经进入稳定版准备阶段。P0 暂不纳入本轮施工，本轮重点处理 P1、P2、P3 中会影响稳定性、移动端体验、识别可信度、后续组件化维护的问题。

最终目标：

- 保持现有线上功能可用，不破坏已上线站点。
- 把高风险单体代码逐步拆成可维护模块。
- 把 CSS 后写修补层收束成清晰规则。
- 把识别、社区、认证、移动端、资源性能分别交给独立线程处理。
- 每个线程都必须留下验证记录，便于总线程统一判断是否可进入稳定版。

## 2. 施工总规则

所有施工线程必须遵守：

- 先读本文。
- 再读：
  - `docs/mobile-web-adaptation-handoff.md`
  - `docs/deep-bug-audit-20260629.md`
  - `docs/production-launch-report-20260629.md`
- 修改前先看 `git status --short --branch`。
- 不回滚其他线程或用户已有改动。
- 前端源文件以项目根目录为准：
  - `index.html`
  - `login.html`
  - `community.html`
  - `privacy.html`
  - `terms.html`
  - `styles.css`
  - `script.js`
  - `assets/`
- 改根目录前端文件后必须运行 `pnpm sync:public`。
- 不要只改 `public/`。
- 后端、Nginx、PM2、证书、数据库改动必须单独线程处理，不要混进移动端 CSS 线程。
- 当前已有另一个线程在做字体、移动端信息流、border 规则，请不要重复覆盖它的范围；如必须接触同一文件，先读差异再小范围追加。

## 3. 优先级口径

P1：稳定版阻塞项。会影响识别可信度、认证安全、移动端主流程、上线发布一致性、后续维护安全。

P2：稳定版前建议处理。会明显影响体验、性能、可访问性、后续扩展，但不一定立即阻断发布。

P3：整理和组件化准备项。主要降低维护成本、减少重复、清理演示残留。

P0：本轮暂不处理。若施工中发现真实 P0，立即停止当前线程，写明证据交给总线程。

## 4. 当前已知状态

只读审查结果：

- 当前未确认生产立即全站不可用 P0。
- `script.js` 约 2370 行，已经是大单体。
- `styles.css` 约 3660 行，多段后写规则覆盖同一批核心组件。
- `pnpm test:atlas` 当前通过，但保留 1 个 warning：
  - OSEA 模型已观察到 11000 维输出。
  - `assets/osea/bird_info.json` 只有 10964 条标签。
  - 缺口 36 条。
- `public/` 与源文件在上次审查时已同步；后续以最新 `git status` 为准。
- `audit/ui-a11y-20260630/` 有移动端截图和指标，390px 关键路径未见横向溢出。
- 当前可能存在另一线程未提交改动：
  - `index.html`
  - `script.js`
  - `app/controllers/auth.controller.js`
  - `public/`
  - `audit/`

## 5. 线程拆分建议

建议拆成 7 个施工线程。每个线程只做自己的范围，完工后回报给总线程。

### 线程 A：OSEA 识别可信度与资源稳定

优先级：P1

目标：

- 处理模型输出 11000 维与标签 10964 条不一致的问题。
- 保证缺失标签不会被静默吞掉。
- 明确产品文案：不能宣称完整 1000+ 准确识别，除非有对应数据和评测。
- 完善弱网、模型加载失败、资源缺失时的重试体验。

重点文件：

- `script.js`
- `scripts/validate-atlas-data.js`
- `assets/osea/bird_info.json`
- `assets/osea/bird_model.onnx`
- `assets/vendor/`
- `docs/bird-recognition-handoff.md`

待修项：

- P1：补齐或显式处理 36 个未映射输出类。
- P1：识别结果文案继续显示映射数量和缺口，避免误导。
- P1：确认 ORT vendor 文件都是有效版本，wasm 魔数校验保留。
- P2：增加用户可见的重试入口，而不仅是“重新选择照片”。
- P2：补文件大小、MIME、图片解码失败提示。

验收：

- `pnpm test:atlas`
- `node --check script.js`
- 首页上传本地翠鸟图能返回 Top 5。
- 模拟标签加载失败后可以重试。
- 识别文案不再夸大覆盖能力。

给施工线程的启动话术：

```text
请接手 Birdora OSEA 识别可信度与资源稳定线程。项目在 C:/Users/Administrator/Documents/逸轩_开发/website/birdora-web。

先读：
docs/stability-repair-master-plan-20260630.md
docs/deep-bug-audit-20260629.md
docs/bird-recognition-handoff.md

本线程只处理识别模型、标签映射、加载失败重试、上传文件保护和识别文案。不要改移动端 CSS、认证后端、Nginx、PM2。

重点检查 script.js、scripts/validate-atlas-data.js、assets/osea、assets/vendor。
修复后运行 pnpm test:atlas、node --check script.js，并记录验证结果。
```

### 线程 B：移动端主流程、信息流、字体、border 规则

优先级：P1

目标：

- 统一移动端信息流、顶部栏、识别卡、社区卡、图鉴跑马灯的布局行为。
- 制定并落地 border 7 规则。
- 字体和字号在 360/375/390/414/430/768 宽度稳定。
- 不用页面级 `overflow-x: hidden` 掩盖真实问题。

重点文件：

- `styles.css`
- `index.html`
- `community.html`
- `login.html`
- `audit/ui-a11y-20260630/`

待修项：

- P1：全尺寸移动端无横向溢出。
- P1：顶部栏在长昵称、登录/退出、返回发布按钮下不挤压。
- P1：`#identify` 上传区、预览图、结果卡、Top 5、发布按钮都可见。
- P1：社区信息流卡片、评论展开、发布表单不互相遮挡。
- P2：合并重复断点，减少“最终修正”层。
- P2：按钮触控高度不低于 44px。
- P3：把圆角 token、卡片边框、按钮边框抽成清楚规则。

验收尺寸：

- 360 x 800
- 375 x 667
- 390 x 844
- 414 x 896
- 430 x 932
- 768 x 1024
- 667 x 375

验收：

- 每个尺寸首页、登录页、社区页无横向滚动。
- 识别上传后结果卡不截断关键内容。
- 评论展开后可输入、可发送、可收起。
- `pnpm sync:public`
- 截图或指标记录放入 `audit/` 或文档。

给施工线程的启动话术：

```text
请接手 Birdora 移动端主流程、信息流、字体与 border 规则线程。项目在 C:/Users/Administrator/Documents/逸轩_开发/website/birdora-web。

先读：
docs/stability-repair-master-plan-20260630.md
docs/mobile-web-adaptation-handoff.md
audit/ui-a11y-20260630/screenshot-metrics.json

本线程只做前端移动端 UI/CSS/HTML 体验修复。不要改后端、Nginx、PM2、数据库。

重点处理 styles.css 中 topbar、hero、identify、result-card、feed-card、community、atlas marquee 的重复覆盖。根目录源文件改完后必须 pnpm sync:public。
验收 360/375/390/414/430/768/667x375 尺寸，并记录截图或指标。
```

### 线程 C：认证与会话稳定

优先级：P1

目标：

- 保证登录、注册、退出、状态恢复稳定。
- Cookie 过期时间与 JWT 过期时间一致。
- 认证服务异常时只读页面不被整页踢走。
- 认证接口测试稳定可重复。

重点文件：

- `app/controllers/auth.controller.js`
- `app/middleware/auth-jwt.js`
- `app/services/token.service.js`
- `app/services/user.service.js`
- `app/db/database.js`
- `scripts/test-auth.js`
- `script.js`
- `docs/auth-api.md`

待修项：

- P1：确认 cookie-only 响应，不返回 JWT JSON。
- P1：确认 cookie maxAge 与 `JWT_EXPIRES_IN` 不冲突。
- P1：认证异常只吞 JWT 类错误，数据库/服务错误进入错误处理。
- P1：状态接口保持只读，不触发 SQLite 写。
- P2：登录后 `next` 回跳保留 hash 和目标页。
- P2：认证服务不可用时只读页面保留，写入动作提示登录或服务不可用。

验收：

- `pnpm test:auth`
- `node --check app/controllers/auth.controller.js`
- `node --check app/middleware/auth-jwt.js`
- 首页/社区在认证 API 不可用时仍能读。
- 登录 `next=/index.html#community` 后回到对应锚点。

给施工线程的启动话术：

```text
请接手 Birdora 认证与会话稳定线程。项目在 C:/Users/Administrator/Documents/逸轩_开发/website/birdora-web。

先读：
docs/stability-repair-master-plan-20260630.md
docs/backend-handoff.md
docs/auth-api.md
docs/deep-bug-audit-20260629.md

本线程只处理认证后端、前端认证状态、next 回跳、cookie/JWT 生命周期和认证测试。不要改移动端 CSS、识别模型、Nginx。

修复后运行 pnpm test:auth，并记录 cookie-only、退出失效、status/me、next hash 回跳验证。
```

### 线程 D：资源性能与静态发布包

优先级：P2

目标：

- 降低移动端首次打开成本。
- 清理未引用 vendor。
- 优化大图资源。
- 保证 Nginx/本地静态缓存策略一致。

重点文件：

- `assets/`
- `public/assets/`
- `scripts/sync-public.js`
- `scripts/static-server.js`
- `deploy/nginx/birdora-https.conf`
- `index.html`
- `community.html`

待修项：

- P2：首页 hero PNG、设备图生成 WebP/AVIF 和小屏版本。
- P2：给关键图片补 `width`、`height`、`loading`、`decoding`。
- P2：社区页不加载 ORT。
- P3：确认 `tf.min.js`、`mobilenet.min.js` 是否未使用，未使用则移出发布包或记录保留原因。
- P2：静态缓存策略保持 HTML/CSS/JS no-cache，assets immutable。

验收：

- 首页、社区页 Network 中社区页不再加载 `ort.min.js`。
- 图片尺寸和懒加载生效。
- `pnpm sync:public`
- `pnpm test:atlas`
- 本地静态服务器资源 MIME 正确。

给施工线程的启动话术：

```text
请接手 Birdora 资源性能与静态发布包线程。项目在 C:/Users/Administrator/Documents/逸轩_开发/website/birdora-web。

先读：
docs/stability-repair-master-plan-20260630.md
docs/deployment.md
docs/deep-bug-audit-20260629.md

本线程只处理图片、vendor 加载、静态同步、缓存策略和发布包体积。不要改认证业务逻辑、移动端布局细节、识别算法。

重点检查 community.html 是否无识别入口却加载 ORT，assets 大图是否需要 WebP/AVIF，小屏资源是否可用。修复后 pnpm sync:public，并记录资源体积变化。
```

### 线程 E：社区数据、信息流交互与可访问性

优先级：P2

目标：

- 让社区发布、我的帖子、评论、推荐流在移动端和键盘访问下稳定。
- 明确 localStorage 演示数据边界。
- 补齐 ARIA 和 label。

重点文件：

- `script.js`
- `index.html`
- `community.html`
- `styles.css`
- `privacy.html`

待修项：

- P2：发布后进入社区默认能看到自己的帖子。
- P2：评论输入、发送、展开、收起在手机端稳定。
- P2：社区 tab ARIA 完整，方向键可操作。
- P2：搜索、发帖标题、正文、动态评论输入都有 label 或 aria-label。
- P3：localStorage 数据结构校验和损坏数据恢复。
- P3：隐私政策继续说明社区数据当前是本地演示缓存。

验收：

- 登录后发布帖子，点“更多”能看到新帖。
- 未登录查看推荐、登录查看我的帖子都正常。
- 评论展开后无横向溢出。
- 键盘可切换社区 tab。
- `node --check script.js`
- `pnpm sync:public`

给施工线程的启动话术：

```text
请接手 Birdora 社区数据、信息流交互与可访问性线程。项目在 C:/Users/Administrator/Documents/逸轩_开发/website/birdora-web。

先读：
docs/stability-repair-master-plan-20260630.md
docs/mobile-web-adaptation-handoff.md
audit/ui-a11y-20260630/screenshot-metrics.json

本线程只处理社区发布、信息流、评论、tab、label/ARIA、localStorage 数据保护。不要改识别模型、认证后端、Nginx。

修复后验证：发布后可见自己的帖子，评论可展开/输入/发送，tab 键盘可操作，移动端无横向溢出。根目录文件改完必须 pnpm sync:public。
```

### 线程 F：SEO、分享信息与文案可信度

优先级：P2

目标：

- 补首页、社区、登录、协议页的基础 SEO 和分享信息。
- 识别能力文案真实，不夸大。
- 登录页、协议页 robots/canonical 策略明确。

重点文件：

- `index.html`
- `community.html`
- `login.html`
- `privacy.html`
- `terms.html`
- `README.md`

待修项：

- P2：补 description、canonical、OG、Twitter、theme-color。
- P2：登录页考虑 noindex 或明确 canonical。
- P2：识别文案从“全量准确识别”改成“返回 Top 5 候选/辅助识别”。
- P3：README 与线上文案保持一致。

验收：

- 每个页面 head 信息完整。
- 文案不宣称未验证的准确率。
- `pnpm sync:public`

给施工线程的启动话术：

```text
请接手 Birdora SEO、分享信息与文案可信度线程。项目在 C:/Users/Administrator/Documents/逸轩_开发/website/birdora-web。

先读：
docs/stability-repair-master-plan-20260630.md
docs/deep-bug-audit-20260629.md
docs/bird-recognition-handoff.md

本线程只改页面 head、SEO/social meta、README 和用户可见文案。不要改功能逻辑、CSS 大布局、后端。

重点避免夸大识别覆盖和准确率。改根目录 HTML 后必须 pnpm sync:public。
```

### 线程 G：前端模块化与组件化准备

优先级：P3，等 A-E 主要修复稳定后再做

目标：

- 把 `script.js` 从大单体拆成清晰模块。
- 把 `styles.css` 从补丁堆叠改成分区或组件规则。
- 降低后续每次改 UI 都互相覆盖的风险。

建议拆分方向：

- `core/dom.js`：选择器、事件、escapeHtml、storage。
- `auth/client.js`：登录状态、请求、跳转。
- `community/feed.js`：帖子、评论、tab。
- `recognition/osea.js`：模型加载、标签、Top K。
- `atlas/index.js`：图鉴搜索、详情、跑马灯。
- `device/mock.js`：设备连接模拟。
- `ui/reveal.js`：滚动 reveal、首页社区动效。

CSS 建议分区：

- tokens
- base
- topbar
- buttons/forms
- hero
- recognition
- atlas
- community/feed
- auth
- docs/footer
- responsive

待修项：

- P3：删除重复 `escapeHtml`。
- P3：减少 `!important`。
- P3：把 “Final hero radius fix” 和 “Responsive repair layer” 收束进正式组件规则。
- P3：建立 border/radius token 的单一来源。

验收：

- 拆分后页面行为不变。
- `node --check` 覆盖所有 JS 文件。
- 首页、登录、社区、协议页可打开。
- `pnpm sync:public`
- 用截图或指标证明移动端无退化。

给施工线程的启动话术：

```text
请接手 Birdora 前端模块化与组件化准备线程。项目在 C:/Users/Administrator/Documents/逸轩_开发/website/birdora-web。

先读：
docs/stability-repair-master-plan-20260630.md
docs/mobile-web-adaptation-handoff.md
docs/deep-bug-audit-20260629.md

本线程只做结构拆分和低风险整理，必须保持功能行为不变。不要混入新功能，不要改后端，不要重做视觉设计。

优先拆 script.js 的基础工具、auth、community、recognition、atlas、device、reveal。CSS 只做分区和规则收束，不做大视觉改版。每一步都要能回归验证。
```

## 6. 总施工顺序

推荐顺序：

1. 线程 B：移动端主流程、信息流、字体、border 规则。
2. 线程 C：认证与会话稳定。
3. 线程 A：OSEA 识别可信度与资源稳定。
4. 线程 E：社区数据、信息流交互与可访问性。
5. 线程 D：资源性能与静态发布包。
6. 线程 F：SEO、分享信息与文案可信度。
7. 线程 G：前端模块化与组件化准备。

原因：

- 移动端和认证是稳定版体验底座。
- 识别可信度是产品承诺底座。
- 社区交互和资源性能随后补强。
- SEO/文案可以在功能稳定后统一校准。
- 模块化最好在主要行为定型后做，避免拆完又大改。

## 7. 每个线程完工必须回报

每个施工线程最终回答必须包含：

- 修改范围。
- 未触碰范围。
- 运行过的验证命令。
- 移动端截图或指标位置。
- 是否运行 `pnpm sync:public`。
- 是否有遗留问题。
- 是否影响生产部署。

推荐格式：

```text
本线程完成：
- ...

验证：
- ...

未处理/需要总线程确认：
- ...

涉及文件：
- ...
```

## 8. 总线程验收清单

所有线程结束后，总线程统一检查：

- `git status --short --branch`
- `node --check script.js`
- `pnpm test:atlas`
- `pnpm test:auth`
- `pnpm sync:public`
- 源文件与 `public/` 关键文件一致。
- 移动端 360/375/390/414/430/768/667x375 无横向溢出。
- 首页、登录、社区、协议页可打开。
- 上传识别、Top 5、发布、评论、退出登录可用。
- 社区页不加载不需要的识别模型资源。
- 文案不夸大识别能力。
- `audit/` 或文档中有最终验收记录。

## 9. 当前总线程备注

- P0 由总策划侧暂不纳入本轮。
- 当前另有线程在做字体、移动端信息流、border 规则。线程 B 要接着它的现场读，不要重开一套视觉规则。
- 如果任何线程遇到同文件并发改动，先读 `git diff`，只追加自己的小范围修复。
- 稳定版前最怕“修一个地方压坏另一个地方”，所以所有 CSS 和 `script.js` 改动都要小步验证。
