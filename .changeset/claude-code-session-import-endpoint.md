---
"@kilocode/cli": minor
---

Expose Claude Code and OpenAI Codex session transcript import through a CLI server endpoint (`POST /kilocode/session-resume`), so any client can import an external JSONL transcript into an empty Kilo session by passing the raw transcript content. The existing `/resume-claude` and `/resume-codex` slash commands now share this same import path.
