---
"@kilocode/cli": patch
---

Fix: `$schema` injection now works for comment-first JSONC configs (previously broken by regex-based insertion)

Fix: `$schema`-less comment-first JSONC configs are no longer rewritten on every load — the regex never matched them, so the schema was never persisted and the unchanged content was rewritten repeatedly, causing mtime churn, git dirty state, and file-watcher loops
