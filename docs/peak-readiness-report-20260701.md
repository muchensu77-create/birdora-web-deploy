# Birdora 50 人峰值准备验收报告

日期：2026-07-01

目标峰值日期：2026-07-03

## 1. 最新版本来源

已从 GitHub 获取最新远端信息。

当前本地基线：

```text
remote: deploy-temp
repo: https://github.com/muchensu77-create/birdora-web-deploy.git
branch: fix/ui-a11y-audit-hardening
tag: v1.3.0
commit: d8a6db7
```

同时确认开发仓库：

```text
origin: https://github.com/yuki-liuk/birdora-web.git
default branch: main
```

说明：`origin/main` 当前仍是较早的初始网站版本；生产交接和远端标签显示，`deploy-temp/fix/ui-a11y-audit-hardening` 的 `v1.3.0` 是本次可用的最新部署系版本。

## 2. 本轮已完成

已新增接手入口：

```text
AGENTS.md
docs/peak-readiness-handoff-20260701.md
```

已补齐图文社区后端闭环：

- 图文帖子保存在 SQLite。
- 发布和编辑时会生成轻量文案分析：评分、摘要、标签、建议。
- 社区列表接口支持 `limit` / `offset` 分页，社区页支持加载更多。
- 帖子可带 1 张 JPG / PNG / WebP 配图，单图限制 1MB。
- 图片默认保存在 SQLite 数据库同级目录的 `uploads/community/`，也可用 `COMMUNITY_UPLOAD_DIR` 显式指定。
- 其他账号可浏览公开帖子。
- 其他账号可评价：`有帮助`、`想了解`。
- 其他账号可评论。
- 其他账号可提问。
- 发布者可编辑自己的标题和正文，也可删除自己的帖子。
- 非发布者编辑和删除会被后端拒绝。
- 删除帖子时会清理对应图片文件。
- 上传图片会校验真实文件头，伪装成图片的文本会被拒绝。
- 社区写接口已加登录用户维度限流。

新增测试入口：

```text
pnpm test:community
pnpm test:peak
```

## 3. 鸟类识别状态

当前状态：可用，但不应夸大宣传。

已确认：

- 页面有鸟照上传入口。
- OSEA 模型文件存在：`public/assets/osea/bird_model.onnx`
- 标签文件存在：`public/assets/osea/bird_info.json`
- 页面文案显示已接入 `sun-jiao/osea_mobile`，识别返回 Top 5 候选。
- 图鉴校验通过：13 个富资料 profile、100 个候选、0 个错误。

仍有警告：

```text
bird_info.json contains 10964 labels, but the current OSEA model has been observed returning 11000 logits.
```

结论：可以说“支持万级鸟类标签候选 / Top 5 辅助识别”，不要说“已精准识别 1000+ / 11000 种”。

## 4. 测试结果

本地服务：

```text
API: http://127.0.0.1:4000
Web: http://127.0.0.1:4174
```

通过：

```text
pnpm test:auth
pnpm test:community
pnpm test:atlas
pnpm test:peak
```

社区测试覆盖：

- A 账号注册登录。
- B 账号注册登录。
- A 发布带图文案。
- 后端生成文案分析。
- 后端返回图片 URL。
- 图片接口可读取。
- B 可看到 A 的帖子。
- B 不能编辑 A 的帖子。
- B 可评价、评论、提问。
- A 可编辑自己的帖子。
- B 删除 A 的帖子会被拒绝。
- 伪造图片内容会被拒绝。
- 删除帖子后图片地址返回 404。
- B 刷新后能看到已持久化的评论、提问、评价。
- A 可删除自己的帖子。

浏览器验证：

- 本地首页可打开。
- 鸟类识别上传入口存在。
- 首页真实发布成功。
- 社区页能看到真实持久化帖子和文案分析结果。
- 评论和提问面板可展开、可提交并回显。
- 评论按钮实测 44px，社区页顶部操作按钮实测 48px。
- 浏览器控制台未发现错误。

## 5. 50 人峰值演练

使用临时端口和临时数据库演练，未污染本地正式数据库。

结果：

```text
50 users browse community list: failures=0, p95=31ms
10 users publish posts: failures=0, p95=22ms
3 uploaded post images are readable: failures=0, p95=6ms
20 users react to one post: failures=0, p95=36ms
20 users comment on one post: failures=0, p95=40ms
10 users ask questions: failures=0, p95=20ms
author edits own post: failures=0, p95=2ms
non-author edit is rejected: failures=0, p95=2ms
50 users refresh community list: failures=0, p95=47ms
Peak test result: PASS
```

结论：当前本地单机 SQLite 版本可支撑 50 人轻量浏览、发布、互动演练。

注意：该峰值测试仍是社区 API 轻量演练，不覆盖真实浏览器静态资源、ONNX/WASM 首载和 5 人同时识别；带图发布只覆盖 3 张 tiny PNG，不代表大图峰值。

## 6. 当前判断

两天后 50 人峰值：可演示，偏可上线。

上线前建议补充：

1. 正式服务器环境复跑 `pnpm test:auth`、`pnpm test:community` 和一次 50 人峰值。
2. 给 `/var/lib/birdora` 或生产数据目录加自动备份。
3. 图片上传长期建议迁移到对象存储，当前本地文件适合小规模单机。
4. 继续处理 OSEA 标签 10,964 vs 11,000 输出数量差异。
5. 若“文案分析”要求 AI 改写或审核，目前只有轻量规则分析 MVP，尚未接入独立文案分析模型。
6. 八路专项审核详见 `docs/eight-agent-audit-report-20260701.md`。
