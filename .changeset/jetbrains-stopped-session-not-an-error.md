---
"@kilocode/kilo-jetbrains": minor
---

Stop treating a manually stopped session as a failure, and add a Retry action to failed turns. Pressing Stop now shows a short "Stopped" note instead of an error badge and attention dot. A failed turn keeps the error badge and card and can be retried in place, using the model and effort selected at that moment — so switching away from an unavailable provider and pressing Retry continues the conversation. This includes failures that never produced a reply, such as missing provider credentials.
