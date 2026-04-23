---
"@kilocode/cli": patch
---

Drop older inline media attachments (images/PDFs returned from tools) from the request when their accumulated base64 payload would exceed the provider's 4MB limit, keeping the newest ones intact.
