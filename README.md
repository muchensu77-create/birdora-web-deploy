# Birdora 观鸟眼镜网站

这是 Birdora 观鸟眼镜的网站原型，包含首页、鸟照识别、鸟类图鉴、分享社区和设备状态页面。

## 怎么打开

如果只是看页面，可以直接双击 `index.html`。

如果要使用 OSEA 鸟类 AI 识别，建议在这个文件夹里启动本地静态服务器：

```bash
python3 -m http.server 4174
```

然后打开：

```text
http://localhost:4174
```

直接用 `file://` 打开时，浏览器可能会因为安全限制导致 ONNX 模型加载失败。

## 主要文件

- `index.html`：页面结构
- `styles.css`：页面样式
- `script.js`：交互逻辑、图鉴数据、OSEA 模型推理逻辑
- `assets/osea/bird_model.onnx`：来自 `sun-jiao/osea_mobile` 的鸟类识别模型
- `assets/osea/bird_info.json`：OSEA 鸟类标签信息
- `assets/vendor/`：浏览器运行 ONNX 模型需要的运行时文件
- `assets/`：首页、设备和鸟类图片资源

## 当前支持识别的 10 种鸟

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

## 继续开发提示

如果要增加更多识别鸟种，在 `script.js` 里修改：

- `birds`：图鉴卡片和中文介绍
- `recognitionRules`：OSEA 模型输出索引到网站鸟种的映射

OSEA 标签索引来自 `assets/osea/bird_info.json`。

## 开源来源

鸟类识别模型来自：

https://github.com/sun-jiao/osea_mobile

该仓库使用 GPL-3.0 许可证。继续发布或改造时请注意遵守原项目许可证。
