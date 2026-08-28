---
"@kilocode/kilo-jetbrains": minor
---

Stop treating a manually stopped session as a failure, and add a Retry action to failed turns. Pressing Stop now shows a short "Stopped" note instead of an error badge and attention dot. Retry continues the failed turn where it stopped, keeping the conversation and any file changes it already made, and runs with the model and effort selected at that moment — so switching away from an unavailable provider and pressing Retry picks the new one up. This includes failures that never produced a reply, such as missing provider credentials.
