---
"@kilocode/cli": minor
---

Migrate Claude Code and OpenAI Codex sessions into Kilo through the CLI server. `POST /kilocode/migrate/sessions` finds the Claude Code / Codex transcripts for a directory and migrates each one into its own Kilo session, remembering what it already migrated so calling it again does nothing. `POST /kilocode/migrate/sessions/discover` previews what is available (title, format, message count, model) and marks sessions that have already been migrated, so clients can show a picker first. The existing `/resume-claude` and `/resume-codex` slash commands share the same import path.
