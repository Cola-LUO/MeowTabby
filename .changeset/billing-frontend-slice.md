---
"@read-frog/extension": minor
---

feat(billing): switch hosted AI to billing-backend with in-extension account

- Hosted text features (page/selection/input/subtitles/summarization/language
  detection) now stream from the billing backend via SSE /v1/generate with
  idempotent retries, cancel linkage and deduct-to-zero settlement
- In-extension account: register with email verification code, log in, reset
  password, balance display and logout (options page Account section)
- Billing channel is rate-limited to one in-flight batch; 402 drains the page
  queue with a recharge prompt, 401 clears the session
- Free channels (DeepL/DeepLX/Google/Microsoft) and BYOK providers unchanged
