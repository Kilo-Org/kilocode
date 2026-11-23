---
"@kilocode/cli": patch
"kilo-code": patch
---

The write tool now refuses to write when the target changed before the write verifies it, and names that reason in its answer. It also names a target that is not a regular file, or whose filesystem reports no usable identity.
