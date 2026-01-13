---
"@kilocode/cli": patch
---

Add extension path resolution for F5 debug workflow

- CLI resolves extension from src/dist/ when KILOCODE_DEV_CLI_PATH is set
- Add watch:cli:setup and watch:cli:deps tasks for reliable CLI builds
