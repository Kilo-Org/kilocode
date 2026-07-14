---
"kilo-code": patch
---

Fix custom theme backgrounds given as `[r, g, b, a]` tuples (e.g. `[0, 0, 0, 0]`) falling back to an opaque color. Tuple values now resolve with their alpha channel intact, so transparent backgrounds render as intended.
