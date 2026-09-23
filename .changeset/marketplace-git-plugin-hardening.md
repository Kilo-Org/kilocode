---
"@kilocode/cli": patch
---

Fix git-hosted Marketplace plugins so `~/` repository paths resolve, a failed clone leaves no staging directory, POSIX paths that contain a backslash are preserved, and uninstalling a plugin deletes its cloned cache when no scope still uses it. The plugin install dialog no longer describes every plugin as an npm plugin.
