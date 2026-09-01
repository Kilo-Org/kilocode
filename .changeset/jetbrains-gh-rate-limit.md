---
"@kilocode/kilo-jetbrains": patch
---

Explain it when GitHub rate limits your token instead of silently dropping every pull request badge. Kilo now keeps the badges it already resolved, says why they stopped updating, slows its checks right down until the limit clears, and picks up on its own once it does.
