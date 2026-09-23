---
"kilo-code": minor
"@kilocode/cli": minor
---

Install Marketplace plugins from a git repository. Plugin catalog entries can now use a git source such as `git:github.com/owner/repo@v1.2.3#subdir`, so a plugin can be distributed from a public repository without publishing to npm. The client clones the repository at the pinned ref into the plugin cache and loads the plugin from there.
