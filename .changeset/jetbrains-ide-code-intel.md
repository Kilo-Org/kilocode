---
"@kilocode/cli": minor
---

Support an experimental `intellij_read` tool for JetBrains-backed definitions, references, implementations, symbols, and type hierarchy. When IntelliJ is still indexing or the project has not been imported yet, the tool reports that code intelligence is unavailable and tells the agent to fall back to text-based search instead of trusting an empty result.
