---
"@kilocode/cli": patch
"kilo-code": patch
---

Changes from opencode v1.14.51 to v1.15.4 upstream:

- Core Improvements: Clarified how to recover when the npm package is installed without its native binary.
- Core Improvements: Reduced unnecessary prompting around shell, task, and todo flows.
- Core Bugfixes: Ignored invalid exports in custom tool modules instead of failing tool loading.
- Core Bugfixes: Ignored project instruction lookup errors so sessions keep loading when project instruction discovery fails.
- Core Bugfixes: Fixed versioned event projector lookups so event replay uses the right handlers.
- Core Bugfixes: Avoid duplicate consecutive entries in prompt history.
- Core Bugfixes: Show full config validation errors during TUI startup instead of a generic failure.
- Core Bugfixes: Fixed npm installs so the CLI can recover and fetch the right native binary on more setups.
- Core Bugfixes: Fixed multiline `@` mentions in prompts.
- Core Bugfixes: Preserved custom tool metadata from Zod schemas.
- Core Bugfixes: Preserved custom tool argument descriptions in generated schemas.
- Core Bugfixes: Fixed file watching in repos where `.git` is a symlink. (@kagura-agent)
- Core Bugfixes: Fixed sync events not reaching project-scoped subscribers in injected instances.
- Core Bugfixes: Reduced wasted work when reading very large files after output truncation.
- Core Bugfixes: Fixed project-scoped bus events so file watcher and update notifications reach the right instance.
- Core Bugfixes: Fixed custom LSP servers not sending refresh events after they initialize.
- Core Bugfixes: Hid background subagent task instructions unless experimental background mode is enabled.
- TUI Improvements: Added a collapsed thinking view that can be expanded inline.
- TUI Improvements: Added pinned sessions with quick-switch slots in the session picker.
- TUI Improvements: Newly pinned sessions now stay at the end of the pinned list instead of jumping to the top.
- TUI Improvements: Made Markdown H1 headings easier to distinguish.
- TUI Bugfixes: Fixed thinking mode defaults so reasoning starts collapsed consistently.
- TUI Bugfixes: Limited session quick-switching to pinned sessions.
- TUI Bugfixes: Fixed Markdown table rendering in chat output.
- TUI Bugfixes: Fixed `kilo run --agent` resolving project-local agents.
- TUI Bugfixes: Fixed async commands losing the active instance context, which could break agent generation and GitHub-driven runs.
