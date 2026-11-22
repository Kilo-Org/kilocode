---
"@kilocode/cli": patch
---

Report a missing Cloudflare AI Gateway credential as a missing credential that names the environment variable to set, and report a gateway token that is configured but cannot be resolved as a configuration error instead of silently falling back to another credential source.
