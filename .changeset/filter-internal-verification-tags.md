---
"kilo-code": patch
---

Filter internal verification tags from assistant messages before displaying to users

Internal XML tags (`<internal_verification>`) used for skill evaluation control flow were leaking to the chat interface. These tags are now filtered out in `presentAssistantMessage.ts`, similar to how `<thinking>` tags are already handled.
