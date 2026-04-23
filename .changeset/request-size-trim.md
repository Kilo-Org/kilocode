---
"@kilocode/cli": patch
---

Drop older tool outputs from the request when the accumulated payload would exceed the provider's 4MB limit, keeping recent tool results intact. The original output stays on disk so the model can still pull it back via Read or Grep.
