---
"@kilocode/cli": patch
---

Drop older tool outputs and inline media attachments (images/PDFs returned from tools) from the request when the accumulated payload would exceed the provider's 4MB limit, keeping the newest ones intact. The original tool output stays on disk so the model can still pull it back via Read or Grep.
