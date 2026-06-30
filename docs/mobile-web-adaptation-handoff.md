# Birdora 手机网页版适配修复交接文档

记录日期：2026-06-29

## 1. 线程目标

新线程目标：修复 Birdora 手机网页版适配问题，让正式站点在常见手机浏览器中可稳定注册、登录、浏览、上传鸟照、查看识别结果、发布社区内容。

正式站点：

```text
https://birdora.birdai-glasses.com/
```

本线程只做前端移动端体验修复。除非发现前端接口地址或鉴权跳转有明确 bug，否则不要改后端、Nginx、证书、PM2、数据库或服务器旧项目。

## 2. 当前生产状态

生产上线已经完成：

- `https://birdora.birdai-glasses.com/` 返回 `200`
- `https://birdora.birdai-glasses.com/api/health` 返回 `birdora-auth-api`
- 私有文件路径如 `/server.js`、`/app/data/...` 返回 `404`
- `jewelry-api.birdai-glasses.com` 保持正常
- PM2 服务 `birdora-web-auth` 在线

生产交接详见：

```text
docs/production-launch-report-20260629.md
```

重要边界：

- 不要停止 `birdora-api`
- 不要停止 `birdora-recognition...`
- 不要停止 `birdora-studio`
- 不要停止 `zhubao-api`
- 不要修改 `jewelry-api.birdai-glasses.com` 的 Nginx 配置
- 不要升级服务器全局 Node

## 3. 文件结构

主要前端源文件：

```text
index.html
login.html
community.html
privacy.html
terms.html
styles.css
script.js
assets/
```

生产公开目录：

```text
public/
```

编辑原则：

- 优先修改项目根目录下的 `*.html`、`styles.css`、`script.js`、`assets/`。
- 修改后运行 `pnpm sync:public`，把源文件同步到 `public/`。
- 不要只改 `public/` 后忘记同步源文件，否则后续会被覆盖。

同步脚本：

```bash
pnpm sync:public
```

## 4. 本地启动方式

本地后端：

```bash
pnpm start
```

默认 API：

```text
http://127.0.0.1:4000
```

本地静态站点：

```bash
pnpm start:web
```

默认页面：

```text
http://127.0.0.1:4174/login.html
```

前端在本地 `4174` 端口运行时，会自动把认证请求发到 `4000` 端口。

## 5. 必测页面

登录/注册：

```text
/login.html
```

首页主流程：

```text
/index.html
```

社区页：

```text
/community.html
```

协议页：

```text
/terms.html
/privacy.html
```

## 6. 移动端重点风险

P0：必须先查

- `styles.css` 存在多轮后写样式和多组 `@media` 断点。先梳理覆盖顺序，再修具体页面。
- 顶部导航在小屏隐藏 `.nav`，但按钮区 `.topbar-actions`、退出登录、返回发布可能仍挤压。
- 首页 `.hero` 多处后写规则设置 `border-radius`、`clip-path`、`margin`，手机端可能造成首屏横向溢出或高度过长。
- `#identify` 识别区包含上传框、结果卡、候选列表，手机端需要保证上传入口、预览图、Top 5 候选、发布按钮都可见且不互相压住。
- `.result-card` 在桌面曾被多次压缩高度，移动端要确认 `max-height`、`overflow`、候选列表不会截断关键内容。
- 社区发布区 `#community` 的标题输入、正文 textarea、按钮组、预览卡片在窄屏需要单列且按钮不溢出。
- 登录注册页表单在小屏上要能完整显示，键盘弹出后按钮和错误提示不能被遮住。

P1：体验优化

- 手机端标题字号不要过大，避免中文标题断行难看。
- 所有主按钮触控高度建议不低于 `44px`。
- 图片、鸟类卡片、设备图不能造成横向滚动。
- 评论输入框、社区筛选 tab、图鉴搜索框需要可点击、可输入、可回退。
- 移动端上传图片后，预览图比例要稳定，不能把结果卡推到过远位置。

P2：清理型改动

- 合并重复或互相覆盖的移动端断点。
- 把“最终修正”类 CSS 放到更清晰的位置，减少后续维护成本。
- 如果不影响上线，可以逐步减少 `!important` 和重复选择器。

## 7. 建议验收尺寸

至少覆盖：

```text
360 x 800   Android 常见窄屏
375 x 667   iPhone SE
390 x 844   iPhone 12/13/14
414 x 896   iPhone Plus/Max
430 x 932   大屏 iPhone
768 x 1024  iPad 竖屏
667 x 375   小屏横屏
```

每个尺寸检查：

- 页面没有横向滚动条
- 首屏没有内容互相遮挡
- 顶部栏不会挤压品牌名和按钮
- 表单输入、按钮点击、滚动锚点正常
- 上传图片后预览和结果卡可读
- 社区发布和评论区域可操作
- 登录后刷新仍保持登录
- 退出登录后回到登录页

## 8. 建议工作顺序

1. 本地启动后端和静态站点。
2. 先用手机尺寸截图或浏览器设备模拟器跑一遍全站，记录真实 bug。
3. 先处理全局横向溢出和顶部栏。
4. 再处理登录注册页。
5. 再处理首页 `hero`、识别区、图鉴区、社区区、设备区。
6. 最后处理 `community.html`、`terms.html`、`privacy.html`。
7. 每轮改动后运行 `pnpm sync:public`。
8. 用本地移动尺寸复查。
9. 不改后端的情况下，不需要重启生产 PM2。

## 9. 上线方式

如果只改 HTML/CSS/前端 JS：

1. 确认本地 `pnpm sync:public` 已执行。
2. 把改动同步到服务器 `/var/www/birdora-web`。
3. 在服务器执行：

```bash
cd /var/www/birdora-web
pnpm sync:public
nginx -t
systemctl reload nginx
```

如果改了依赖或后端，必须另开后端部署评估，不要混在手机适配线程里直接上线。

上线后验证：

```bash
curl -I https://birdora.birdai-glasses.com/
curl -i https://birdora.birdai-glasses.com/api/health
curl -I https://jewelry-api.birdai-glasses.com
```

## 10. 当前已知上下文

服务器当前部署来源为 GitHub 临时部署仓库：

```text
https://github.com/muchensu77-create/birdora-web-deploy
branch: deploy/birdora-web-20260629
```

本地工作区当前可能存在鸟类图鉴、脚本和样式相关未提交改动。新线程开始前需要先看：

```bash
git status --short
```

不要把无关的鸟类识别能力扩展和手机适配 bug 修复混在同一个提交里。

## 11. 可直接给新线程的启动说明

```text
请接手 Birdora 手机网页版适配 bug 修复。项目在 C:/Users/Administrator/Documents/逸轩_开发/website/birdora-web。

正式站点已上线：https://birdora.birdai-glasses.com/
本线程只修前端移动端适配，不改后端、Nginx、证书、PM2、数据库，也不要影响 jewelry-api。

请先阅读：
docs/production-launch-report-20260629.md
docs/mobile-web-adaptation-handoff.md

重点检查 login.html、index.html、community.html、terms.html、privacy.html，在 360/375/390/414/430/768 宽度下修复横向溢出、顶部栏挤压、登录表单、首页 hero、AI 识别上传区、识别结果卡、图鉴、社区发布/评论等移动端问题。

编辑根目录源文件后必须运行 pnpm sync:public，同步到 public/。每轮改动后做本地移动端截图验收，并记录修复清单。
```
