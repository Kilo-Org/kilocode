---
"@kilocode/cli": patch
---

Preserve model output capacity when requests contain encoded images. The output token cap now uses the provider-reported context size from the previous turn, so image and vision input is measured by the provider instead of by encoded payload size.
