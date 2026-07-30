---
"@kilocode/cli": patch
---

Add `kilo auth token [provider]` to print a configured provider's credential to stdout for scripting. Defaults to the `kilo` provider; supports `api`, `oauth`, and `wellknown` credential types. `--help` lists every configured provider.
