# MeowTabby（翻译喵）

<div align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/English-gray?style=flat-square"></a>
  <a href="./README.zh-CN.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-gray?style=flat-square"></a>
</div>

MeowTabby 是一款开源浏览器翻译扩展。阅读网页、视频字幕和 PDF 时，都可以直接查看译文；还可以在翻译中心并排比较不同服务的结果。

## 目录

1. [主要功能](#1-主要功能)
2. [安装与开发](#2-安装与开发)
3. [致谢与许可](#3-致谢与许可)

## 1. 主要功能

- **网页翻译**：双语和仅译文模式、划词翻译、上下文辅助翻译。
- **PDF 对照翻译**：逐页显示原文与译文；识别标题、正文、图片等区域，按阅读顺序组织译文。版面识别模型在首次使用时下载并缓存。扫描件等没有文字层的 PDF 暂不支持。
- **翻译中心**：并排比较多个翻译服务的结果。
- **字幕与朗读**：翻译视频字幕，提供文字转语音功能。
- **翻译服务**：支持自选服务商并填写 API Key，也提供内置 AI 通道。

复杂 PDF 的排版效果因文件而异，建议先用免费接口检查译文和版面。

## 2. 安装与开发

需要 Node.js 26.7 或兼容版本及 pnpm 11。依赖版本以 [package.json](./package.json) 为准。

```bash
pnpm install
pnpm dev
pnpm build
SKIP_FREE_API=true pnpm test
```

生产构建位于 `.output/chrome-mv3/`，可在 `chrome://extensions` 开启开发者模式后加载该目录。Edge 和 Firefox 分别可使用 `pnpm build:edge`、`pnpm build:firefox`。

环境变量示例见 [.env.example](./.env.example)，PDF 实现说明见 [PROJECT_DOCS.md](./PROJECT_DOCS.md)。

## 3. 致谢与许可

MeowTabby 基于 [Read Frog](https://github.com/mengxi-ream/read-frog) 开发。感谢 Read Frog 作者及以下项目的贡献：

| 项目                                    | 本项目如何使用                     | 来源                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read Frog                               | 扩展的基础代码                     | [项目仓库](https://github.com/mengxi-ream/read-frog)                                                                                                                        |
| DocLayout-YOLO                          | PDF 版面识别                       | [项目仓库](https://github.com/opendatalab/DocLayout-YOLO)                                                                                                                   |
| DocLayout-YOLO DocStructBench ONNX 模型 | PDF 版面识别模型，由浏览器下载使用 | [模型页面](https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx)                                                                                                 |
| Docling                                 | PDF 阅读顺序算法的移植来源         | [项目仓库](https://github.com/docling-project/docling) · [参考文件](https://github.com/docling-project/docling/blob/main/docling/models/postprocessing/reading_order_rb.py) |
| ONNX Runtime Web                        | 在浏览器中运行 ONNX 模型           | [项目仓库](https://github.com/microsoft/onnxruntime)                                                                                                                        |

本仓库代码依据 [GPL-3.0](./LICENSE) 发布，并保留上游项目的版权声明。MeowTabby 的修改部分由 Cola-LUO 维护。
