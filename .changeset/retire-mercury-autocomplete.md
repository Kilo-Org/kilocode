---
"kilo-code": minor
"@kilocode/cli": minor
"@kilocode/sdk": minor
"@kilocode/kilo-gateway": minor
---

Retire the Mercury Edit 2 autocomplete models and Next Edit. Codestral is now the default autocomplete model, and saved Mercury or Inception selections use Codestral. The SDK no longer has `client.kilo.edit`, and `@kilocode/kilo-gateway` no longer exports `./edit` or `./edit-prompt`.
