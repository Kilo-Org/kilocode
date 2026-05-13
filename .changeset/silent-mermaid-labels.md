---
"kilo-code": patch
"@kilocode/cli": patch
---

Fix Mermaid diagrams rendering with empty text inside every shape by restoring the `foreignObject` HTML integration point that DOMPurify dropped in 3.1.7.
