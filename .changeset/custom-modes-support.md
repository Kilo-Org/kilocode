---
"@kilocode/cli": patch
"kilo-code": patch
---

feat(cli): add custom modes support and refactor implementation

This PR adds support for loading custom modes from both global and project-specific configuration files. Custom modes can be defined in YAML format and will be merged with default modes, with project modes taking precedence over global modes.
