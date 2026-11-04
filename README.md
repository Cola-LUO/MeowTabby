# MeowTabby

<div align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/English-gray?style=flat-square"></a>
  <a href="./README.zh-CN.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-gray?style=flat-square"></a>
</div>

MeowTabby is an open-source browser extension for translating web pages, video subtitles, and PDFs. Its translation hub also lets you compare results from different services side by side.

## Contents

1. [Features](#1-features)
2. [Build from source](#2-build-from-source)
3. [Acknowledgments and license](#3-acknowledgments-and-license)

## 1. Features

- **Web translation:** Switch between bilingual and translation-only views, translate selected text, and use page context to improve translations.
- **Side-by-side PDF translation:** Read the original and translation page by page. Layout detection identifies titles, body text, images, and other regions; reading-order logic organizes the translated text. The layout model is downloaded and cached on first use. Scanned PDFs without a text layer are not currently supported.
- **Translation hub:** Compare translations from multiple services in one place.
- **Subtitles and text-to-speech:** Translate video subtitles and listen to selected text.
- **Translation services:** Bring your own API key and provider, or use the built-in AI service.

Layout results vary with complex PDFs. Try a free translation service first to check the text and page layout.

## 2. Build from source

Use Node.js 26.7 or a compatible version and pnpm 11. See [package.json](./package.json) for the exact requirements.

```bash
pnpm install
pnpm dev
pnpm build
SKIP_FREE_API=true pnpm test
```

The Chrome production build is written to `.output/chrome-mv3/`. To load it, enable Developer mode at `chrome://extensions` and select that directory. Use `pnpm build:edge` or `pnpm build:firefox` for the other browsers.

See [.env.example](./.env.example) for environment variables and [PROJECT_DOCS.md](./PROJECT_DOCS.md) for PDF implementation details.

## 3. Acknowledgments and license

MeowTabby is based on [Read Frog](https://github.com/mengxi-ream/read-frog). Thank you to its authors and to the projects used in the PDF feature:

| Project                                  | How MeowTabby uses it                             | Source                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read Frog                                | Foundation of the browser extension               | [Repository](https://github.com/mengxi-ream/read-frog)                                                                                                                              |
| DocLayout-YOLO                           | PDF layout detection                              | [Repository](https://github.com/opendatalab/DocLayout-YOLO)                                                                                                                         |
| DocLayout-YOLO DocStructBench ONNX model | Layout model downloaded by the browser            | [Model page](https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx)                                                                                                       |
| Docling                                  | Source of the adapted PDF reading-order algorithm | [Repository](https://github.com/docling-project/docling) · [Reference file](https://github.com/docling-project/docling/blob/main/docling/models/postprocessing/reading_order_rb.py) |
| ONNX Runtime Web                         | Running the ONNX model in the browser             | [Repository](https://github.com/microsoft/onnxruntime)                                                                                                                              |

This repository is released under [GPL-3.0](./LICENSE) and retains the upstream copyright notices. The MeowTabby modifications are maintained by Cola-LUO.
