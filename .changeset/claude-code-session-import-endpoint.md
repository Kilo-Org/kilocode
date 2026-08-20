---
"@kilocode/cli": minor
---

Expose Claude Code and OpenAI Codex session transcript import through a CLI server endpoint (`POST /kilocode/session-resume`), so any client can import an external JSONL transcript into an empty Kilo session by passing the raw transcript content. The existing `/resume-claude` and `/resume-codex` slash commands now share this same import path. A companion `POST /kilocode/session-resume/discover` endpoint enumerates available Claude Code / Codex transcripts for a directory and previews each one (title, format, message count, model), so clients can list importable sessions before importing.
