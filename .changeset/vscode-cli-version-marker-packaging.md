---
"kilo-code": patch
---

Stop shipping the local-only `.cli-version` build marker in packaged VSIX installs, which previously made production installs detect as local builds and inject a dev-only bwrap fallback.
