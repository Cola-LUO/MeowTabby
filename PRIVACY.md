# 翻译喵（MeowTabby）隐私政策

**生效日期：2026 年 11 月 3 日**

翻译喵（MeowTabby，下称"本扩展"）是一款基于 GPL-3.0 开源的浏览器翻译扩展（[源代码](https://github.com/Cola-LUO/meowtabby)）。我们深知个人信息对你的重要性，并会按照本政策处理你的数据。使用本扩展即表示你已理解并同意本政策的内容。

## 1. 我们收集哪些数据

### 1.1 账户信息（仅当使用内置翻译服务时）

使用内置的按量计费翻译服务时，你需要注册账户，我们会收集：

- **邮箱地址**：作为登录名，并用于发送验证码与密码重置邮件；
- **密码**：仅以哈希形式存储，我们无法看到你的明文密码；
- **可选昵称**：注册时可自行填写。

### 1.2 翻译内容

翻译内容（网页选中文本、输入框文本、PDF 页面中提取的文本）按你选择的翻译通道发送：

- **内置服务通道**：内容经由我们的服务器（`mtapi.netxmeow.top`）转发至 DeepSeek 等 AI 服务商完成翻译；
- **自配服务商通道**：内容由你的浏览器**直接**发送至你自己配置的 AI 服务商（如 DeepSeek、OpenRouter 或 OpenAI 兼容接口），**不经过我们的服务器**。

PDF 翻译的原文件完全在你的浏览器本地解析与渲染，**原 PDF 文件不会被上传**；参与翻译的仅是从页面提取的文本。

### 1.3 使用与计费记录（仅内置服务通道）

为计费与防滥用，我们的服务器会记录：请求时间、所用模型、token 用量、余额变动等账目信息。

### 1.4 登录会话与 IP

- 登录成功后生成的 `session_id` 保存在你浏览器的本地存储（`chrome.storage.local`）中，服务端仅存其哈希值，有效期 7 天；
- 你的 IP 地址用于登录失败锁定等安全防护与限流，不做用户画像。

### 1.5 匿名统计（当前未启用）

本扩展内置 PostHog 匿名统计代码。当前发布的版本**未配置统计服务，该功能处于关闭状态**。若未来版本启用，我们将在此处更新说明，并仅收集匿名的功能使用事件，不包含你的翻译内容。

### 1.6 可选功能

- **版面识别模型下载**：PDF 翻译首次使用时会从 huggingface.co（或其镜像 hf-mirror.com）下载约 75MB 的开源模型文件，下载源可看到你的 IP；模型缓存在本地，之后不再重复下载。

## 2. 我们如何使用数据

- 提供翻译服务与计费扣费；
- 发送账户相关的邮件（验证码、密码重置）；
- 保障服务安全（限流、登录保护）；
- 处理你提出的问题与数据请求。

我们**不会**出售你的个人信息，**不会**将你的翻译内容用于训练 AI 模型，**不会**将你的数据用于广告投放。

## 3. 数据共享的第三方

| 第三方                            | 何时涉及           | 共享内容                             |
| --------------------------------- | ------------------ | ------------------------------------ |
| DeepSeek 等 AI 服务商             | 使用内置服务翻译时 | 待翻译文本                           |
| 邮件发送服务（阿里云 DirectMail） | 注册/找回密码      | 你的邮箱地址、验证邮件               |
| 你自行配置的 AI 服务商            | 使用自配通道时     | 待翻译文本（浏览器直连，与我们无关） |
| huggingface.co / hf-mirror.com    | 首次下载识别模型   | 下载请求（含 IP）                    |
| PostHog                           | 匿名统计启用后     | 匿名使用事件                         |

除上述情形及法律强制要求外，我们不会向任何第三方提供你的数据。

## 4. 数据存储与安全

- 服务端数据（账户、账目）存储于我们的服务器，传输全程使用 HTTPS 加密；
- 密码与 `session_id` 均只存哈希值，库里无明文；
- 扩展配置数据存于你自己的浏览器配置目录中。

官网反馈与工单使用注册邮箱识别提交者。我们保存工单正文、回复和邮箱，用于在页面内处理与回复，不发送工单邮件。提交时 Cloudflare Turnstile 会处理验证请求。官网将登录会话保存在浏览器本地；安装扩展后与扩展共享会话。

## 5. 数据保留与删除

- 账户与计费账目在账户存续期间保留；
- 登录会话 7 天后自动过期；
- 工单附件上传满 14 天自动删除，工单正文和回复继续保留；
- 你可以随时要求删除账户及相关数据：通过第 7 节的联系方式向我们提出，我们将在合理期限内处理并回复。

## 6. 未成年人保护

本扩展面向一般用户，不面向 14 周岁以下儿童，我们不会有意收集儿童的个人信息。

## 7. 联系我们

对本政策或数据处理有任何问题、建议或删除请求，请联系：

**邮箱：luofchn@outlook.com**

我们将在收到后尽快回复（通常不超过 7 个工作日）。

## 8. 政策更新

我们可能适时修订本政策，修订后的版本会在本页面发布并更新生效日期。重大变更会通过适当方式提示你。

---

# MeowTabby Privacy Policy (English)

**Effective date: November 3, 2026**

MeowTabby ("the extension") is an open-source (GPL-3.0) browser translation extension. This policy explains what data we collect and how we handle it. By using the extension, you agree to this policy.

## 1. Data We Collect

### 1.1 Account Information (built-in translation service only)

- **Email address**: used as your login name and for verification / password-reset emails;
- **Password**: stored only as a hash; we never see or store your plaintext password;
- **Optional display name**.

### 1.2 Translation Content

Depending on the translation channel you choose:

- **Built-in service**: content is relayed through our server (`mtapi.netxmeow.top`) to AI providers such as DeepSeek;
- **Your own provider**: content is sent **directly from your browser** to the provider you configured (DeepSeek, OpenRouter, or any OpenAI-compatible endpoint) and **never touches our servers**.

PDF files are parsed and rendered **entirely locally** in your browser; the original PDF is never uploaded. Only extracted text is sent for translation.

### 1.3 Usage & Billing Records (built-in service only)

Timestamps, model used, token usage, and balance changes, for billing and abuse prevention.

### 1.4 Session & IP

- The `session_id` is stored in your browser's local storage; our server stores only its hash. Sessions expire after 7 days.
- Your IP address is used for rate limiting and login protection only.

### 1.5 Anonymous Analytics (currently disabled)

The extension contains PostHog analytics code, but the shipped build has **no analytics configured and it is disabled**. If enabled in a future version, this policy will be updated, and only anonymous usage events (never your translation content) would be collected.

### 1.6 Optional Features

- **Layout model download**: on first use of PDF translation, a ~75MB open-source model is downloaded from huggingface.co (or mirror hf-mirror.com), then cached locally.

## 2. How We Use Data

To provide translation and billing services, send account-related emails, keep the service secure, and handle your requests. We do **not** sell your personal information, do **not** use your translation content to train AI models, and do **not** use your data for advertising.

## 3. Third Parties

| Third party                         | When                             | Data shared                                  |
| ----------------------------------- | -------------------------------- | -------------------------------------------- |
| AI providers (e.g. DeepSeek)        | Translation via built-in service | Text to translate                            |
| Email delivery (Alibaba DirectMail) | Registration / password reset    | Your email address                           |
| Providers you configure             | Own-provider channel             | Text to translate (direct from your browser) |
| huggingface.co / hf-mirror.com      | First model download             | Download request (incl. IP)                  |
| PostHog                             | Only if analytics is enabled     | Anonymous usage events                       |

We do not disclose your data to any other parties except where required by law.

## 4. Storage & Security

Server data is transmitted over HTTPS; passwords and session IDs are stored only as hashes; extension configuration is stored in your browser profile.

Website feedback and support tickets use your registered email to identify you. We store the ticket, replies and email to respond on the website; no ticket emails are sent. Cloudflare Turnstile processes verification requests at submission. The website stores the login session locally in your browser and shares it with the extension when installed.

## 5. Retention & Deletion

Accounts and billing records are kept while the account exists; sessions expire after 7 days. You may request deletion of your account and data at any time via the contact below.

## 6. Children

The extension is not directed to children under 14, and we do not knowingly collect their personal information.

## 7. Contact

**Email: luofchn@outlook.com**

We typically respond within 7 business days.

## 8. Changes

We may update this policy; the current version is always published on this page with its effective date.
