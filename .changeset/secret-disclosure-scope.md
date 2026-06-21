---
"@kilocode/cli": patch
---

Add a scope-discipline rule to the default system prompt so broad "copy/sync/mirror everything" tasks don't sweep credential files (private keys, `.env`, tokens, PII) into publicly readable destinations. The agent copies the non-secret files and leaves credentials in place; moving secrets between protected locations is unaffected.
