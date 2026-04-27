---
"kilo-code": patch
---

Run plugin `config()` hooks before reading provider config and fetching models.dev data, so plugins that mutate `enabled_providers`, `disabled_providers`, or `provider` are consistently honored by the provider list and the kilo provider injection logic.
