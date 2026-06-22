---
"@kilocode/cli": patch
---

Add a scope rule to the default system prompt so cleanup/reset tasks don't delete backups, credentials, or the only copy of data. The agent deletes only clearly-disposable files and keeps protected files in place.
