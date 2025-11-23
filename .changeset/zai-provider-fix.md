---
"@kilocode/cli": patch
---

Fixes z.ai provider setup failure by collecting all required configuration fields. The authentication wizard now prompts for API line selection (international_coding or china_coding) and sets the default model to gpt-4o.

Fixes #3828
