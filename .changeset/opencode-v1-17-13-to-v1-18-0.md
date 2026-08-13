---
"@kilocode/cli": patch
"kilo-code": patch
---

Changes from opencode v1.17.13 to v1.18.0 upstream:

- Core Improvements: Added a code mode MCP adapter for running confined orchestration scripts against connected MCP tools.
- Core Improvements: Hid the `execute` tool unless code mode is enabled.
- Core Improvements: Add a model-specific system prompt for Meta Muse Spark.
- Core Improvements: Updated Azure AI support for GPT-5.6.
- Core Bugfixes: Fixed paginated MCP tool catalogs losing tool metadata and output schema validation.
- Core Bugfixes: Preserved low reasoning effort for OpenRouter small-model variants instead of disabling it.
- Core Bugfixes: Fixed GitHub Copilot model routing to honor each model's advertised chat or responses endpoint.
- Core Bugfixes: Fixed session lists to match equivalent instance directories reliably.
- Core Bugfixes: Fixed Cerebras reasoning replay so earlier assistant reasoning is sent back in the provider-supported field.
- Core Bugfixes: Better classify Z.ai context-window overflow errors so oversized requests surface the right failure mode (@fengjikui)
- Core Bugfixes: Handle unavailable config directories more gracefully when reading config files
- Core Bugfixes: Exposed reasoning effort variants for Grok models.
- Core Bugfixes: Improved xAI prompt cache routing and PDF file support in Responses models.
- Core Bugfixes: Improved Meta model handling for reasoning variants and provider requests.
- Core Bugfixes: Prevent crashes and bad pricing data when GitHub Copilot returns models with a zero billing batch size.
- Core Bugfixes: Supported OpenAI pro reasoning mode.
- Core Bugfixes: Disabled response storage by default for xAI Responses. (@geraint0923)
- Core Bugfixes: Added OAuth support for Luna Responses Lite.
- Core Bugfixes: Switched to another available org after logging out in the console.
- Core Bugfixes: Used Codex context limits for GPT-5.6 over OAuth. (@nabilfreeman)
- Core Bugfixes: Removed an obsolete Codex workaround that could interfere with OpenAI Luna Responses Lite requests.
- TUI Bugfixes: Fixed spinner registration so loading indicators keep rendering across TUI surfaces.
- TUI Bugfixes: Forwarded CLI environment variables to the TUI worker.
