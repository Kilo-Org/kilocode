---
"@kilocode/kilo-jetbrains": patch
---

Remove old JetBrains CLI binaries so they no longer accumulate in the IDE cache. Only the active version is kept, the downloaded archive is deleted after extraction, and reinstalling re-downloads a fresh binary.
