---
"@kilocode/cli": minor
---

Migrate Claude Code and OpenAI Codex sessions into Kilo through the CLI server. `POST /kilocode/migrate/sessions` takes a raw JSONL transcript and migrates it into an empty Kilo session, so any client can bring existing work over from another coding agent. A companion `POST /kilocode/migrate/sessions/discover` enumerates available Claude Code / Codex transcripts for a directory and previews each one (title, format, message count, model), so clients can list migratable sessions first. The existing `/resume-claude` and `/resume-codex` slash commands now share this same path.
