# Birdora 鸟类识别交接文档

更新日期：2026-06-29

## 1. 当前结论

当前网站的 AI 识鸟能力已完成阶段 A：上传图片后从 OSEA 全量标签库返回 **Top 5 候选**，不再限制在 10 种演示鸟种内。

底层 OSEA 模型标签库很大：`assets/osea/bird_info.json` 当前包含 **10,964** 个鸟类标签。因此项目具备扩展到 1000+ 种展示的基础。图鉴第二阶段已开始：页面会用 OSEA 标签库生成基础图鉴索引，并支持识别候选点击进入图鉴详情。不过当前本地图鉴富资料仍只补充了 10 种常见鸟，1000+ 图鉴内容、图片版权和准确率评测尚未完成。

## 2. 当前资源

模型文件：

```text
public/assets/osea/bird_model.onnx
```

标签文件：

```text
public/assets/osea/bird_info.json
```

标签格式示例：

```json
["非洲鸵鸟", "Common Ostrich", "Struthio camelus"]
```

当前标签数量：

```text
10964
```

## 3. 当前代码位置

前端主逻辑：

```text
script.js
public/script.js
```

当前网站图鉴数据：

```js
assets/atlas/bird-profiles.json
```

当前用于把全量识别结果关联回本地图鉴的方式：

```js
富图鉴资料中的 oseaIndex 会生成 localAtlasMatches
```

当前推理入口：

```js
async function classifyImageElement(imageElement)
```

当前结果展示：

```js
function setResult(...)
function setUnknownResult(...)
```

## 4. 当前限制

### 已放开全量候选，但图鉴资料还只有 10 种

当前识别逻辑会读取全部 OSEA logits，并从 10,964 个标签里返回 Top 5。若 Top 1 命中本地图鉴的 10 种，会展示本地图鉴特征；若没有命中，会展示 OSEA 中文名、英文名、拉丁名，并提示“图鉴资料待补充”。

这意味着今天上线可以展示：

- 模型全量 Top 5 候选
- 当前本地图鉴是否已收录
- 低置信度时的“未确定鸟种”提示

### 富图鉴内容只有 10 种

`assets/atlas/bird-profiles.json` 目前只有 10 个本地介绍卡片。其他 OSEA 标签会作为基础图鉴索引展示中文名、英文名和拉丁名，但没有对应图片、栖息地、特征、食物等完整展示资料。

## 5. 扩展到 1000+ 种的推荐方案

建议分两阶段做，不要一口气把体验和数据都搅在一起。

### 阶段 A：放开模型 Top-K（已完成）

目标：模型可以从全部 10,964 个标签中返回 Top 5。

已完成：

1. 加载 `bird_info.json`。
2. 对 ONNX 输出的全部 logits 做 Top-K。
3. 用标签 index 映射中文名、英文名、拉丁名。
4. 给每个候选计算全量 softmax 归一化分数。
5. 增加置信度阈值，低于阈值显示“无法确定”。
6. UI 展示 Top 5 候选，而不是只显示一个结果。

阶段 A 完成后，可以宣传：

```text
模型可返回 1000+ 鸟类候选结果
```

但仍不建议宣传“精准识别 1000 种”，除非做过评测。

### 阶段 B：扩展图鉴和产品体验

目标：让 1000+ 结果能被用户看懂。

已开始：

1. 用 OSEA 标签生成基础图鉴索引。
2. 图鉴支持中文名、英文名和拉丁名搜索。
3. 识别 Top 5 候选可点击进入图鉴详情。

还要补：

1. 1000+ 鸟类基础资料。
2. 图片来源和版权。
3. 栖息地、特征、分布、相似鸟。
4. “相似物种对比”或“再拍一张”的引导。

## 6. 技术注意事项

- `bird_info.json` 约 700KB，可以前端加载，但要注意首次加载体验。
- `bird_model.onnx` 约 27MB，首次加载会慢，需要清晰 loading 状态。
- 全量 softmax 10,964 项在浏览器里可做，但建议只对 Top-K 展示，避免 UI 卡顿。
- 如果未来移动端性能不稳，可以考虑把推理放到后端或边缘服务。
- 图片和鸟类资料必须处理版权，不能随便抓图上线。

## 7. 建议给下一个线程的任务描述

可以直接把下面这段发给新线程：

```text
请接手 Birdora 的 AI 鸟类识别扩展。当前项目路径是 C:\Users\Administrator\Documents\逸轩_开发\website\birdora-web。

当前 OSEA 模型文件在 public/assets/osea/bird_model.onnx，标签文件在 public/assets/osea/bird_info.json，标签数量 10,964。现在 script.js 已经从全量标签中返回 Top 5，并通过 localAtlasMatches 把已补充资料的 10 种鸟关联回本地图鉴。

目标：继续推进阶段 B，补齐更多鸟类资料、图片版权、搜索筛选和候选详情页。不要改后端认证逻辑，除非另开后端任务。
```

## 8. 当前建议

在没有评测集之前，页面文案建议写：

```text
AI 模型支持万级鸟类标签候选，本演示版优先展示常见鸟种与 Top 候选结果。
```

不要写：

```text
准确识别 1000 种鸟
```
