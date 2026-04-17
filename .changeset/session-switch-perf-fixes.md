---
"kilo-code": patch
"@opencode-ai/ui": patch
---

Make session switching near-instant. Restores the two-pass markdown rendering that was accidentally reverted during an upstream merge (code blocks now upgrade to Shiki highlighting after first paint instead of blocking it), and adds a fast-path that skips redundant reactive work when a focus-mode reconcile finds the server tail matches local state. Also fixes a few edge cases around pagination: the "load earlier" button keeps working when proxies strip the pagination header, sub-agent viewer loads the full transcript instead of truncating to 80 messages, in-flight message fetches for a deleted session no longer resurrect it as a ghost entry, and removing a message cleans up its stashed parts.
