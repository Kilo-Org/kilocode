---
"@kilocode/cli": patch
---

Fix Amazon Bedrock models returning no output. A smithy dependency version-skew made the Bedrock event-stream decoder silently fail under the browser build condition, so every Bedrock request completed with an empty response.
