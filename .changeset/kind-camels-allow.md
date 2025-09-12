---
"kilo-code": minor
---

feat: Performance improvements by moving extension state to file-based storage

This change addresses the "large extension state detected" warning by migrating task history and custom modes storage from globalState to disk-based storage. This improves extension performance and stability.

WHAT: Extension state is now stored in files instead of VS Code's globalState
WHY: To reduce memory usage and improve performance by avoiding large extension state warnings
HOW: No consumer changes required - this is an internal optimization
