---
"kilo-code": patch
---

Fix detectComplexity algorithm in Gemini CLI model router

- Use word boundary matching for keywords to avoid false positives
- Fix simple keyword penalty capping logic
- Improve list detection with per-item complexity bonus
- Add missing complex keywords (scalable, authentication, oauth, implement)
