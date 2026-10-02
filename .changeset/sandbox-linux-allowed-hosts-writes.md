---
"@kilocode/cli": patch
---

Fix `write` and `edit` tools on Linux when the sandbox allows specific network hosts. Before, these tools failed with "Filesystem worker returned an invalid response".
