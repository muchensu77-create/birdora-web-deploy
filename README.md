# Birdora 观鸟眼镜网站

这是 Birdora 观鸟眼镜的网站原型，包含首页、鸟照识别、鸟类图鉴、分享社区和设备状态页面。

## 怎么打开

如果只是看页面，可以直接双击 `index.html`。

如果要使用 OSEA 鸟类 AI 识别和账号登录，需要同时启动前端静态服务器和后端认证服务。

后端认证服务：

```bash
pnpm install
pnpm start
```

后端要求 Node.js `24.14.0` 或更高版本。

默认 API 地址：

```text
http://localhost:4000
```

本地后端默认允许这两个前端地址跨域访问：

```text
http://localhost:4174
http://127.0.0.1:4174
```

前端静态服务器：

```bash
pnpm start:web
```

`pnpm start:web` 会先同步根目录的 HTML/CSS/JS 和 `assets/` 到 `public/`，再只从 `public/` 提供静态文件。

然后打开：

```text
http://localhost:4174
```

直接用 `file://` 打开时，浏览器可能会因为安全限制导致 ONNX 模型加载失败。

不要从项目根目录启动 `python -m http.server`，否则会暴露 `app/`、`docs/`、`server.js` 等后端私有文件。本项目的公开静态文件在 `public/`。

本地前端默认会请求 `http://localhost:4000/api`。如果要改后端地址，可以在加载 `script.js` 前设置：

```html
<script>
  window.BIRDORA_API_BASE_URL = "http://localhost:4000";
</script>
```

## 主要文件

- `index.html`：页面结构
- `styles.css`：页面样式
- `script.js`：交互逻辑、图鉴数据、OSEA 模型推理逻辑
- `public/`：上线和本地预览时唯一应该托管的静态目录
- `server.js`：Express 认证 API 入口
- `app/`：认证路由、控制器、服务和 SQLite 数据库
- `app/data/birdora.sqlite`：本地认证数据库，运行时自动创建，不应提交到 Git
- `assets/atlas/bird-profiles.json`：已补充图文资料的富图鉴数据
- `assets/atlas/common-bird-candidates.json`：第二阶段 100 种常见鸟富资料补齐候选清单
- `assets/osea/bird_model.onnx`：来自 `sun-jiao/osea_mobile` 的鸟类识别模型
- `assets/osea/bird_info.json`：OSEA 鸟类标签信息
- `assets/vendor/`：浏览器运行 ONNX 模型需要的运行时文件
- `assets/`：首页、设备和鸟类图片资源

## 当前识别和图鉴范围

AI 识别已接入 OSEA 模型，会从 `assets/osea/bird_info.json` 的万级鸟类标签中返回 Top 5 候选。

图鉴第二阶段已开始：页面会用 OSEA 标签库生成 10,964 个基础图鉴索引，支持按中文名、英文名和拉丁名搜索。当前本地图鉴优先补充了 11 种常见鸟的图片和介绍：

- 翠鸟
- 白鹭
- 白头鹎
- 珠颈斑鸠
- 灰喜鹊
- 红嘴蓝鹊
- 黑水鸡
- 棕背伯劳
- 家燕
- 麻雀
- 喜鹊

未补齐百科资料的鸟种会显示“基础标签 / 图片待补充 / 资料待补充”，避免误导为完整图鉴。

## 继续开发提示

如果要增加更多富图鉴鸟种：

1. 在 `assets/atlas/bird-profiles.json` 增加资料条目。
2. 确认 `oseaIndex` 来自 `assets/osea/bird_info.json`。
3. 运行 `pnpm test:atlas` 检查字段、重复项和 OSEA 标签匹配。

页面会根据富图鉴资料里的 `oseaIndex` 自动建立 OSEA 标签到本地图鉴的匹配关系。

如果要从 100 种候选清单生成某个鸟种的富资料模板：

```bash
pnpm atlas:template 11
```

这里的 `11` 是 `assets/atlas/common-bird-candidates.json` 里的 `priority`。

第二阶段图鉴资料补齐说明见 `docs/bird-atlas-phase2.md`。

## 开源来源

鸟类识别模型来自：

https://github.com/sun-jiao/osea_mobile

该仓库使用 GPL-3.0 许可证。继续发布或改造时请注意遵守原项目许可证。
