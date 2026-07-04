---
"@kilocode/cli": patch
---

Fix: `$schema` injection now works for comment-first JSONC configs (previously broken by regex-based insertion)

Fix: Config files no longer rewritten on every load — avoids mtime churn, git dirty state, and file-watcher loops
