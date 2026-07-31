---
"@kilocode/cli": minor
"kilo-code": minor
---

Add a `claude-code` provider so a Claude Pro/Max/Team/Enterprise subscription can drive Claude models instead of metered Anthropic API billing. It appears automatically once the Claude Code CLI is installed and signed in, and runs it in headless streaming mode with reasoning-effort variants (matching the same tiering as the Anthropic provider) and image input support. Kilo's own tools are exposed to the CLI through a loopback MCP bridge, so tool calls still flow through Kilo's agent loop, permissions, and UI rather than the CLI acting on its own. The Providers settings page shows it with the official Claude mark and a "Local" tag, consistent with other CLI-detected providers.

Note: Anthropic's billing treatment of headless CLI (`claude -p`) usage is an active, evolving area on their side — a change moving this traffic off the subscription pool onto a separate smaller credit was announced for June 2026 and then paused, not cancelled. This provider reflects current behavior (headless usage draws from the normal subscription pool today) but that could change again without much notice.
