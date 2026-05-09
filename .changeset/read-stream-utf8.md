---
"@kilocode/cli": patch
---

Speed up reading large files: the `read` tool now streams UTF-8 content from disk and stops once the line/byte cap is reached, instead of loading the whole file into memory first.
