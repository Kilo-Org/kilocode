---
"kilo-code": minor
"@kilocode/cli": minor
---

Project Stack recommendations now come from the Marketplace rather than being hard-coded in the CLI. Technology-to-resource associations are fetched from a Marketplace-served catalog and cached locally; the CLI falls back to the bundled snapshot when the Marketplace is unreachable. Only Kilo-curated associations can mark a resource as a default install — publisher advisory tags may surface resources as candidates but never enable them by default.
