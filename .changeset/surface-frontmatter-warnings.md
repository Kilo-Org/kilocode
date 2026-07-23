---
"@kilocode/cli": minor
---

Surface agent and mode YAML frontmatter parse warnings as configuration errors. When an agent or mode file has invalid frontmatter, the error message now includes the file path and source location. Duplicate YAML keys are treated as hard errors rather than silently falling back to permissive parsing.
