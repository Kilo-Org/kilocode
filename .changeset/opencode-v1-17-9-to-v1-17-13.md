---
"@kilocode/cli": patch
"kilo-code": patch
---

Changes from opencode v1.17.9 to v1.17.13 upstream:

- Core Improvements: MCP servers can append their instructions to the model context, and MCP resources are available as tools with template listing.
- Core Improvements: Model variants are generated from models.dev data, including modes exposed as models.
- Core Improvements: Tool definitions pass `strict` through for Codex parity, and Gemini requests support video and audio media.
- Core Bugfixes: Interrupted assistant steps settle instead of leaving sessions stuck busy.
- Core Bugfixes: MCP OAuth reconnects after authorization even when the server is disabled, refreshes credentials on reauthentication, requests refresh token scope, surfaces completion errors, and binds its callback to the IPv4 loopback.
- Core Bugfixes: MCP tool results prefer content over structured output, and denied resource template tools stay hidden.
- Core Bugfixes: Stale GitHub Copilot Responses item IDs are no longer replayed, and OpenAI reasoning variants are forced where required.
- Core Bugfixes: Adaptive thinking is enabled for Claude Sonnet 5, and expired promos were removed from the zen catalog.
- Core Bugfixes: Preserve released prompt history during database replay and keep native event streams connected for all supported Kilo events.
- Core Bugfixes: Remote skill manifests support optional per-skill versions; changing a version refreshes the cached skill atomically, and skill base directories are emitted as filesystem paths.
- CLI Improvements: Ports increment from the default when busy.
- CLI Improvements: Use `--auto` to start the TUI in a run-scoped auto-approve mode, and leave the mode mid-session from the command palette.
- TUI Improvements: Redesigned crash screen, model picker sorted by release date, bindable diff viewer and Move Session commands, main-branch diff source, and inline skill load errors.
- TUI Bugfixes: File autocomplete is scoped to the session, multi-day durations format correctly, and root sessions load in the session switcher.
