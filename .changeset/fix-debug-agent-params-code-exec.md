---
"kilo-code": patch
---

Fix `kilo debug agent --params` executing arbitrary JavaScript via `new Function()` when the input wasn't strict JSON. Loose object-literal syntax (unquoted keys, single quotes) is now parsed safely with JSON5 instead.
