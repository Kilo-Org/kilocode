---
"@kilocode/cli": patch
---

Prefer the session provider's cheapest chat-capable model for auxiliary tasks (session titles, prompt enhance, commit messages, branch names) instead of falling back to Kilo's auto small model. BYOK users no longer silently draw Kilo credits when their configured provider has no recognized small-model family.