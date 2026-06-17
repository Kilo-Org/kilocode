---
"@kilocode/cli": minor
"kilo-code": minor
---

Add Morph auto model routing: selecting the "Auto Router" model under the Morph provider classifies each prompt with Morph's multimodel router and runs the turn on the best model among your connected providers (OpenAI, Anthropic, Google, DeepSeek) using your own credentials. Falls back gracefully when the router is unreachable, and the routing policy is configurable via provider.morph.options.routerPolicy.
