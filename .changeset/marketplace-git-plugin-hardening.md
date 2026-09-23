---
"@kilocode/cli": patch
---

Fix git-hosted Marketplace plugins so `~/` repository paths resolve, a failed clone leaves no staging directory, and POSIX paths that contain a backslash are preserved. The plugin install dialog no longer describes every plugin as an npm plugin.
