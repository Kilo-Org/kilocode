---
"kilo-code": patch
---

fix(core): skip model fetching for non-configured providers

Added conditional API key checks for all providers in the `requestRouterModels` handler.
Providers without configured credentials are now skipped, preventing unnecessary network
requests at startup. This fixes issue #2972 where the CLI was making requests to providers
the user hadn't set up (requesty, deepinfra, glama, etc.).
