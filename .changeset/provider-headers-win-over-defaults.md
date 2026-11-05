---
"@kilocode/cli": patch
---

Headers configured on a provider for Kilo's default attribution (`HTTP-Referer` / `X-Title`, for example OpenRouter app attribution) are now sent on each request in place of Kilo's defaults, including through transports that don't use the provider's SDK options such as Cloudflare AI Gateway.
