---
"@kilocode/kilo-jetbrains": patch
---

Store a migrated provider credential in the shape its provider accepts: the Kilo gateway token keeps the OAuth-shaped envelope the CLI uses for Kilo sign-in, with the organization as the account id, and every other provider stores an api credential. A migrated provider config patch carries its base URL and no secret.
