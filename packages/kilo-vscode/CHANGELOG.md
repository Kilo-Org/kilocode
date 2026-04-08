# Change Log

All notable changes to the "kilo-code" extension will be documented in this file.

This changelog covers the Kilo Code VS Code extension. The extension shares version numbers with the Kilo CLI (`packages/opencode/`).

## 7.2.0

### Added

- Add mutex lock, incremental add, and batched revert to snapshot performance

## 7.1.23

### Added

- Guard against prompt injection in commits
- Add scope context and better git commands to review prompt
- Inject --rm flag for Docker MCP containers to prevent accumulation
- Add support for GLM, Kimi, and Qwen reasoning models
- Follow-up execution is now aware of the saved plan file
- Update minimatch, @modelcontextprotocol/sdk, and @aws-sdk dependencies
- Update Hono to fix authentication bypass and server vulnerabilities
- Update simple-git dependency to fix critical remote code execution vulnerability
- Preserve specific MCP tool rules when propagating permissions to sub-agents
- Propagate MCP restrictions to sub-agents alongside edit and bash
- Preserve inherited restrictions across multi-hop sub-agent chains
- Apply read-only bash and MCP restrictions to plan mode and propagate bash restrictions to sub-agents
- Plan mode now respects edit restrictions and sub-agents inherit caller's file access permissions

## 7.1.22

### Added

- Cache full diff and ignore legacy local storage to prevent redundant git processes

## 7.1.21

### Added

- Session migration improvements for better handling of session state transitions
- Exclude /global/health from request logging
- Add org support for /kiloclaw command

## 7.1.20

### Added

- No extension changes (CLI bug fixes only)

## 7.1.19

### Added

- Fixed hung state disposal during provider authentication refresh
- RevertBanner UI now shows no changes after successful file revert
- Improve SDK claw types
- Add KiloClaw Chat to TUI

### Fixed

- TUI: Guard against null theme in TUI resolveTheme and Proxy

## 7.1.18

### Added

- Prevent unbounded log file growth with size-based rotation
- Import disabled MCPs with enabled: false instead of skipping them
- Skip logging for /log and /telemetry/capture endpoints to improve performance

## 7.1.17

### Added

- No extension changes (CLI bug fixes only)

## 7.1.16

### Added

- Inject plan file path into non-experimental plan mode prompt

## 7.1.15

### Added

- Keep plan follow-up sessions in the same worktree
- Revert prevention of zombie `kilo serve` processes on extension host crash

## 7.1.14

### Added

- Skip request logging for /telemetry/capture endpoint

### Fixed

- Prevent zombie kilo serve processes on extension host crash

## 7.1.13

### Added

- Revert restoration of directory tree in system prompt

## 7.1.12

### Added

- Improved error handling for database migrations
- Migrate legacy sessions into new extension

## 7.1.11

### Added

- Normalize directory path when listing sessions to fix Windows case mismatch

## 7.1.10

### Added

- Restore agent picker labels
- Propagate deprecated field in agent merge and show description in dialog
- Read remote_control from global config only
- Add remote_control config to auto-enable remote session relay

## 7.1.9

### Added

- Gate Kilo API calls behind enabled_providers to prevent data leaks
- Make FreeUsageLimitError non-retryable to prevent unrecoverable backoff loop
- Prevent infinite loop when agent returns empty tool calls

## 7.1.8

### Added

- No extension changes (CLI bug fixes only)

## 7.1.7

### Added

- No extension changes (CLI bug fixes only)

## 7.1.6

### Added

- Isolate checkpoints per worktree
- Strip bloated file contents from tool metadata to fix session loading performance
- Use load-time constant for KILO_SESSION_RETRY_LIMIT
- Hide commit-message git windows on Windows

## 7.1.5

### Added

- Deny task tool usage in subagent sessions unless explicitly allowed by agent
- Always deny task permission in subagent sessions

## 7.1.4

### Added

- Remove commands that can execute arbitrary code from bash allowlist
- Check legacy TOML config for bash permission in migration
- Trim bash allowlist to safe commands and handle legacy config

## 7.1.3

### Added

- Reverted default bash auto-approve rule back to original setting
- Clarify configuration file paths
- Use strict .kilo/ directive in config hint
- Remove `.opencode/` from config directory hint

## 7.1.2

### Added

- Always use kilo.db regardless of channel
- Add missing git config flags to cleanup() for Windows

## 7.1.1

### Added

- More targeted change, now identical to upstream
- Change default bash auto-approve rule to ask
- Remove context-1m-2025-08-07 anthropic-beta header

### Fixed

- TUI: Prevent zombie kilo serve processes on extension host crash

## 7.1.0

### Added

- Improved subagent permissions handling
- Replace x-opencode-_ headers with x-kilo-_ across codebase and upstream scripts
- Resolve missed merge conflicts from previous merge
- Refactor Kilo compatibility for v1.2.24
- Save changes automatically when settings are updated
- Update Storybook due to theme name change in upstream
- Mention config paths in /status tip
- Show onboarding tip for first-time users on free model
- Fix package.json bin configuration after upstream merge
- Refactor Kilo compatibility for v1.2.22
- Add initial support for workspaces into the TUI
- Send context-1m-2025-08-07 beta header to GitLab to enable 1M context window
- Add Copilot GPT-5.4 xhigh support
- Disable fallback to free nano for small model
- Canonicalize working directory after changing directory in TUI
- Fix broken /mcp toggling in TUI
- Update database path test to verify correct channel-based filename
- Allow beta channel to share database with stable channel
- Add OPENCODE_SKIP_MIGRATIONS flag to bypass database migrations

### Fixed

- TUI: Pass missing auth headers in `run --attach`
- TUI: Exclude anonymous Kilo provider from connected check
- TUI: Show tips for connected first-time users
- TUI: Respect tips toggle during onboarding
- TUI: Show config and project paths in /status dialog
- TUI: Prevent TUI from exiting prematurely with proper exit guards
- TUI: Avoid TTY corruption from double cleanup

## 7.0.51

### Added

- Add required id fields to ephemeral environment details part
- Bump opentui to v0.1.87
- Remove "message" typo from system prompt
- Save permissions without disposing instances
- Add Windows ARM64 build support for CLI and VS Code extension
- Delay paste summary in CLI
- Add bell() utility for terminal attention requests
- Update session prompt configuration
- Preserve editor context on synthetic summary user messages
- Recompute environment details when user message changes mid-loop
- Cache environment details per turn for prompt caching
- Include ISO 8601 timestamp with timezone in per-message environment details

## 7.0.50

### Added

- Remove allow always button
- Propagate isFree flag from cloud API through CLI to extension
- Update mDNS runtime defaults from opencode.local to kilo.local
- Updated retry logic in session management
- Add undo/redo functionality with per-message revert button in VS Code extension
- Reset global config lazy cache on session dispose so marketplace writes take effect
- Save permission rules to configuration file
- Replace remaining "opencode" branding references with "kilo"
- Publish bus event after TsClient diagnostics
- Add timeout to TypeScript diagnostic wait to prevent indefinite hanging
- Kill stuck tsgo process after timeout
- Resolve workspace-local tsc from node_modules
- Fallback to TsClient when tsgo LSP spawn fails in experimental mode
- Use persistent tsgo LSP server when KILO_EXPERIMENTAL_LSP_TOOL is enabled
- Remove process tree status dialog feature
- Enable incremental mode for warm tsgo runs, reducing subsequent checks to 200-400ms

## 7.0.49

### Added

- Don't dispose all instances on global config update
- Fix build and publish scripts
- Merge opencode v1.2.19
- Merge opencode v1.2.18
- Add Kilo change markers to shared code for easier upstream merges

### Fixed

- SDK: Fix SDK generation for VS Code extension tests

## 7.0.48

### Added

- Add WarpGrep AI-powered codebase search tool
- Disable external proxy to app.opencode.ai
- Granular bash permission rules
- Use correct config.json schema URL (app.kilo.ai)
- Guard temperature and prevent prompt injection in enhance-prompt
- Add backend route to delete custom mode files from disk
- Use direct generateText for prompt enhancement instead of LLM.stream
- Validate skill location against registry before deletion and re-sync webview on failure
- Adjust for OpenRouter and improve various components
- Switch skill removal to POST with JSON body instead of DELETE with query params
- Return updated skills list from DELETE endpoint to fix stale UI
- Rename routes to KilocodeRoutes at /kilocode prefix
- Add styling and tooltips to permissions UI

## 7.0.47

### Added

- Handle malformed JSON in legacy .kilocode/mcp.json files
- Restore Kilo share URL support in import command
- Use .kilo instead of .kilocode for config directories
- Lazy-load worktree diff details in Agent Manager
- Replace OpenCode with Kilo in OAuth callback pages and auth metadata

## 7.0.46

### Added

- No extension changes (CLI bug fixes only)

## 7.0.45

### Added

- Add README for npm package
- Fix README based on review feedback

### Fixed

- Remove rounded corners from bash output box in vscode extension
- Add beta notice banner to provider settings screen
- Pass time field in cloud session messages to fix TextPartDisplay crash

## 7.0.44

### Added

- Wait for stdio streams to drain before flushing decoders in bash tool
- Flush StringDecoder at EOF to surface trailing buffered bytes
- Use separate StringDecoder per stream to prevent cross-pipe corruption
- Use StringDecoder for UTF-8 multi-byte stream decoding

### Fixed

- Validate cloud session ID starts with 'ses\_' on import
- Revise legacy session ID message and remove formatting-only changes

## 7.0.43

### Added

- No extension changes (CLI bug fixes only)

## 7.0.42

### Added

- Add windowsHide option to all spawn calls to prevent CMD window flash on Windows
- Add --cloud-fork CLI option to import cloud sessions locally

### Fixed

- Skip auto-commit of visual regression screenshots for fork PRs

## 7.0.41

### Added

- Update permission config from string to object format
- Save and load per-agent model selection in CLI
- Migrate .opencode project folder to .kilo
- Use separate task ID for title generation to prevent model leak

### Fixed

- Show todo permission prompts in bottom dock
- Open Settings and Profile in editor panes instead of sidebar
- Add foreground color to selected mode/thinking selector items for light theme contrast
- Replace discord.gg/kilocode URLs with kilo.ai/discord

## 7.0.40

### Added

- Adjusted copy on connect message
- Avoid parsing provider-less Kilo default models in ACP
- Added toast notifications for Kilo errors
- Moved Kilo-specific code to kilocode folder
- Better messages for authentication required errors
- Rename auto-small model to kilo-auto/small
- Migrate default model to kilo-auto/frontier across codebase
- Disallow plan_exit from batch tool execution
- Restore unconditional plan_exit tool registration
- Add model per mode settings
- Remove disposeAll() call on auth to prevent premature resource cleanup

### Fixed

- TUI: Prevent extension hang on server shutdown

## 7.0.39

### Added

- Invalidate model cache on authentication and organization changes and reload state after disposal

### Fixed

- Add cursor pointer to subagent link in chat messages
- Use sidebar background color for chat panel to distinguish from editor
- Change worktree remove icon from X to trash can
- Add cursor pointer to clickable elements
- Remove borders from reasoning blocks and text parts in agent responses
- Right-align prompt enhance and send buttons in chat input
- Filter subagent sessions from session history

## 7.0.38

### Added

- Disable 'kilo web' command (unsupported OpenCode web UI)
- Remove kilocode_change markers from kilo-specific packages
- Improve migration with shared disposeAll debounce, MCP timeout handling, and bash rule merge
- Add KILOCODE_VERSION environment variable support to editor header
- Switch Kilo default model to auto-small
- Update migration UI

### Fixed

- Add colorblind-friendly theme to the CLI

## 7.0.37

### Added

- Ask mode respects user permission configuration for edit tools

### Fixed

- Wrap chat input buttons on narrow sidebar
- Stop doing models.length for every model

## 7.0.36

### Added

- Fix agent interrupt AbortError leak
- Add sparkle button to enhance prompts before sending in VS Code extension
- Bootstrap session ingest after import

## 7.0.35

### Added

- Fix Agent Manager worktree diff base branch calculation
- Check if current branch tracks a remote branch and is up to date with the remote
- Use the family property for model configuration
- Update duplicate reasoning hack after OpenRouter AI SDK patch

### Fixed

- Chat message autocomplete respects autocomplete switch

## 7.0.34

### Added

- Update TUI configuration file
- Update naming conventions across the codebase
- Include opencode directory in build output
- Guard log string allocation behind info check in ingest queue
- Add debug logging for session ingest flush
- Filter notifications by showIn property to target CLI-only and extension-only notifications to the correct client
- Improve error logging and test type safety in VS Code extension
- Update SDK consumers to use renamed Kilo SDK exports
- Rename project references and branding to Kilo
- Refactor Kilo compatibility for v1.2.15
- Fixed most segfaults on Windows with Bun v1.3.10 stable
- Split TUI and server configuration

### Fixed

- TUI: Publish Session.Event.Created on import to trigger session ingestion

## 7.0.33

### Added

- Build and release CLI
- Refactor VS Code chat view
- Refactor code to improve reusability
- Honor model metadata values from API responses
- Refactor for Kilo compatibility with version 1.2.14
- Remove broad memory regression test suite
- Drop MCP transport monkey patching
- Add family, prompt, and variants fields to the Kilo gateway

## 7.0.30

### Added

- Resolve diff viewer race condition and add diagnostics for Agent Manager
- Use Anthropic prompt for kilo/auto model
- Filter tool diagnostics to only edited files, reducing session payload 50-77%

## 7.0.29

### Added

- Add diff viewer panel to Agent Manager
- Update Kilo-specific code markers and documentation
- Fix plugin package name from @opencode-ai/plugin to @kilocode/plugin
- Fix plan_exit call
- Show implementation suggestions only when LLM has all the information

## 7.0.28

### Added

- Refactor Kilo compatibility for v1.2.10
- Refactor Kilo compatibility for v1.2.9
- Refactor for Kilo compatibility with version 1.2.8
- Use toDateString() instead of toISOString() in system prompt to preserve caching
- Update SDK with latest server API changes
- Add support for .kilo configuration file
- Reverse messages before full sync to maintain correct chronological order
- Add endpoint to import Kilo Cloud sessions

## 7.0.27

### Added

- Data migration: flat files in data directory migrated to a single sqlite database
- Refactor for Kilo v1.2.3 compatibility
- Ensure Anthropic models on OpenRouter also have variant support
- Add WAL checkpoint on database open

## 7.0.26

### Added

- Data migration: flat files in data directory migrated to a single sqlite database
- Rename GitHub repository
- Change LLM completion telemetry properties to be consistent with old extension
- Rename database references for consistency
- Include migrations in the build
- Refactor Kilo compatibility for version 1.2.2
- Refactor Kilo for compatibility with v1.2.1
- Refactor Kilo compatibility for v1.2.0
- Update repository URLs from kilo to kilocode
- Add plan followup tracking to telemetry
- Allow reasoning for Claude models on Kilo gateway and restore preserved reasoning
- Add comprehensive test coverage for Session.list() filters
- Filter sessions at database level to improve session list loading performance

---

## Version 5.x to 7.x Note

The VS Code extension was completely rebuilt starting in late 2024. The versioning jumped from 5.x to 7.x to reflect this major rewrite. Versions 4.x through 5.12.0 were from the legacy extension (see [kilocode-legacy repo](https://github.com/Kilo-Org/kilocode-legacy)).

## 5.12.0

### Minor Changes

- Add GLM-5-Turbo and GLM-5.1 models to the Z.AI provider

## 5.11.0

### Minor Changes

- Added notification about the completely rebuilt Kilo Code extension for VS Code.

## 5.10.5

### Patch Changes

- Add MiniMax-M2.7 and MiniMax-M2.7-highspeed models to the MiniMax provider
- Update new user welcome credits from $5 to $2.50

## 5.10.4

### Patch Changes

- Update onboarding premium models text to reflect new first top-up bonus credits offer

## 5.10.3

### Patch Changes

- Add OpenAI's GPT-5.3-Chat-Latest model support
- Add OpenAI's GPT-5.4 model support

## 5.10.2

### Patch Changes

- Add Claude Code Sonnet/Opus 4.6 models to Claude Code and fix OpenAI Codex GPT-5.4 id

## 5.10.1

### Patch Changes

- Add gpt-5.4-codex configuration
- Use separate marketplace README without deprecation notice for VS Code marketplace listing

## 5.10.0

### Minor Changes

- Add Oracle Code Assist provider

### Patch Changes

- Rename leftover `roo-preview` and `roo-debug` temp filenames to `kilo-preview` and `kilo-debug`

## 5.9.0

### Minor Changes

- Add Poe as a supported API provider

### Patch Changes

- Fix OpenAI Responses Azure URL normalization
- Normalize legacy Claude Code model IDs
- Prevent terminal focus stealing in Agent Manager
- Fix OpenAI-compatible Responses fallback requests when custom base URLs already include `/v1`
- Fix blank messages and UI not updating when canceling a task in Agent Manager
- Fix context condensing prompt not saving properly
- Fixed organization selector overlapping with "Recent" text in chat pane header
- Preserve extra_content for Gemini 3 thought_signature support
- Retry Amazon Bedrock network connection lost errors
- Allow dropdowns in Modes modal to be changed
- Add new provider AIHubmix
- Use OpenAI Codex OAuth credentials in Agent Manager so ChatGPT Plus/Pro works in agent mode
- Fixed resumed agent runtime orchestrator tasks so previous task history is preserved
- Fix duplicate text output when using OpenAI-compatible providers with streaming disabled
- Normalize Vertex Claude Opus 4.6 legacy aliases
- Override context window for MiniMax/Kimi free models
- Cap qwen3-max-thinking max_tokens to provider limit

## 5.8.1

### Patch Changes

- Show post-completion suggestions after `code` and `orchestrator` tasks to start `review` mode
- Add X-KiloCode-Feature header for microdollar usage tracking
- Update Gemini default model metadata for Gemini 3.1 Pro
- Fix JetBrains editor initialization when ExtensionHostManager is missing
- Add promotion sign-up prompt when anonymous users hit the promotional model usage limit
- Updated promotion warning text and translations across all 22 languages

## 5.8.0

### Minor Changes

- Add Apertis as a new API provider
- Add MiniMax-M2.5, MiniMax-M2.5-highspeed and MiniMax-M2.1-highspeed models
- Added Voyage AI embedder support

### Patch Changes

- Fix Moonshot coding endpoint model selection
- Add dev container persistence for threads and settings
- Remove deprecated Cerebras models: llama-3.3-70b and qwen-3-32b
- Treat maxReadFileLine=0 as unlimited (same as -1)
- Updates some visual bugs in Agent Behaviour settings page
- Filter internal verification tags from assistant messages
- Fix scroll jump issue when reading long completion messages in Agent Manager
- Prevent context token indicator flickering
- Fix file deletion auto-approve checkbox not being clickable
- Fix recurring MODEL_NO_TOOLS_USED error loop
- Fixed UI issues in Settings search bar: clipping of results and layout shift when expanding
- Fix user message visibility by using distinctive theme-aware colors
- Fix(mentions): process slash commands in tool_result blocks
- Support preserving reasoning content in OpenAI format conversion
- Honor explicit 'disable' for reasoning effort
- "Kill Command" button now reliably terminates processes on all platforms
- Add support for Claude Sonnet 4.6 to Anthropic, Bedrock, and Vertex providers
- Fix(nano-gpt): Add native reasoning field extraction
- Support custom embed dimensions for Ollama provider
- Persist total API cost after message deletion
- Review mode now offers one-click suggestions to apply fixes
- Prevent MCP servers from restarting on every settings file re-read
- Prevent duplicate tool_use/tool_result IDs in conversation history
- Fixed falsy provider settings leak between profiles when switching
- Enhance Anthropic extended thinking compatibility
- Fix tool use failure for providers returning numeric tool call IDs
- Improve symlink handling in skills directory
- Prevent abort listener memory leak in attemptApiRequest
- Implement better formatting for low cost values
- Fixed ZenMux context window detection to prevent erroneous context-condensing loops
- Fixed ZenMux tool-calling reliability

## 5.7.0

### Minor Changes

- Add Zenmux provider

### Patch Changes

- Add minimax 2.1, glm 4.7, updated other models
- Disable zsh history expansion
- Fix attached images being lost when editing a message with checkpoint
- Prevent sending thinkingLevel to unsupporting Gemini models
- Add chars count to ListFilesTool
- Add support for GLM 5 and set Z.ai default to `glm-5`

## 5.6.0

### Minor Changes

- Added Corethink as a new AI provider

### Patch Changes

- Add Slovak (sk) language translation for Kilo Code extension and UI
- Fix(agent-manager): Fix double scrollbar in mode selector dropdowns
- Improve Chutes Kimi reliability
- Fix JetBrains build failure by adding missing vsix dependency for build pipeline
- Show loading spinner immediately when opening review scope dialog
- Fix unreadable text and poor contrast issues in Agent Manager
- Fixed Moonshot Kimi tool-calling and thinking-mode behavior
- Fix 'Delete' toggle button in Auto Approve settings
- Remove duplicate "Kilo Code Marketplace" title in toolbar
- Hook embedding timeout into settings for ollama

## 5.5.0

### Minor Changes

- Add YOLO mode toggle and session rename

### Patch Changes

- Fix Opus 4.6 model name
- Update Discord link in docs footer to use kilo.ai/discord
- Minor improvement of auto-execute commands with input redirection

## 5.4.1

### Patch Changes

- Add support for GPT 5.3 codex in OpenAI Codex provider
- Add a favorited-task checkbox to batch delete in task history
- Add new "devstral-2512" Mistral model configuration

## 5.4.0

### Minor Changes

- Fix: Importing a configuration file blocks the configuration of provider parameters

### Patch Changes

- Add Claude Opus 4.6 model with adaptive thinking support
- Add React Compiler integration to improve UI responsiveness

## 5.3.0

### Minor Changes

- Send x-kilocode-mode header
- Add new welcome screen for improved onboarding

### Patch Changes

- Use brand-colored Kilo Code icons throughout the extension for better visibility
- Fix(ui): prevent TypeError when trimming input during model switching
- Added CONTRIBUTING.md file for onboarding new contributors
- Fix(agent-manager): sync messages when panel is reopened
- Fix contrast on "ideas" intro screen
- Fix double scroll bar in ModelSelector and KiloProfileSelector
- Updated chat UI theme to use muted, theme-aware colors
- Allow Ollama models without tool support for autocomplete
- Prevent chat auto-scroll from jumping while you read older messages
- Add GLM-4.7 Flash model to recommended models list for Z.ai provider
- Add improved support for Kimi 2.5 reasoning through AI SDK

## 5.2.2

### Patch Changes

- Show sign in prompt when trying paid model when not logged in
- Streamline getting started view: move logo to top, reduce suggestions to 2, remove footer hint text

## 5.2.1

### Patch Changes

- Adding Kimi K2.5

## 5.2.0

### Minor Changes

- Improve idea box during onboarding experience

### Patch Changes

- Fix mode selection after anonymous usage
- OpenAI Codex: Add ChatGPT subscription usage limits dashboard
- Add new Kimi models and coding API endpoint
- Updated welcome screen model names in all translations

## 5.1.0

### Minor Changes

- New users can now start using Kilo Code immediately without any configuration - a default Kilo Code Gateway profile with a free model is automatically set up on first launch
- Remove Gemini CLI provider support.

### Patch Changes

- Improved Portuguese (Brazil) translation

## 5.0.0

### Major Changes

- Add Local review mode

### Minor Changes

- Include changes from Roo Code v3.39.0-v3.41.2

### Patch Changes

- Fixed broken image display in Agent Manager message list
- Set default temperature to 1.0 for Cerebras zai-glm-4.7 model
- Improve zh-TW translations
- Add native tool calling support to Nano-GPT provider
- Revert "Using Kilo for work?" button in low credit warning, restore free models link
- Removed forced context compression for volces.com

## 4.153.0

### Minor Changes

- Added OpenAI Compatible (Responses) provider

### Patch Changes

- Increased Agent Manager initial prompt input size for easier editing of longer prompts
- Fixed CLI file duplication bug where content was written twice when creating or editing files

## 4.152.0

### Minor Changes

- Add mode selection to Agent Manager for CLI sessions
- Centralize Agent behaviour settings by removing the top bar MCP button and moving Mode, MCP, Rules, and Workflows configuration into the Agent Behaviour area.

### Patch Changes

- Add loading spinner to agent manager API request messages
- Add session persistence for Agent Manager worktrees
- Fixed agent-manager mode creating `.kilocode-agent` directory in user workspaces. Agent storage now uses OS temp directory instead, keeping workspaces clean.
- Fix model selection not showing in resumed sessions in Agent Manager
- Fix parallel mode completion messaging when commits fail.
- Check that `model_info` field exists before attempting to call Object.keys() on it.
- Display reasoning as collapsible block in Agent Manager instead of plain text
- Add Skills tab to Agent Behaviour settings for viewing and managing installed skills
- Implement oauth 2.1 authorization for http transports
- Force tool use when using Haiku with the Anthropic provider

## 4.151.0

### Minor Changes

- Add support for OpenAI Codex subscriptions
## 4.121.2

### Patch Changes

- [#3951](https://github.com/Kilo-Org/kilocode/pull/3951) [`1f4f9bd`](https://github.com/Kilo-Org/kilocode/commit/1f4f9bdf739d5b0dec0fdef366c1d58b6d3ffbcb) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add Gemini 3 Pro Image Preview

- [#3879](https://github.com/Kilo-Org/kilocode/pull/3879) [`d07e192`](https://github.com/Kilo-Org/kilocode/commit/d07e1924fe5be984a630442cfcc8e3bd3a4879b1) Thanks [@Maosghoul](https://github.com/Maosghoul)! - Optimized MiniMax M2 interleaved thinking by merging environment details into tool results.

- [#3939](https://github.com/Kilo-Org/kilocode/pull/3939) [`189aee3`](https://github.com/Kilo-Org/kilocode/commit/189aee3a36906857d1e6fb02c05081382e87bf4e) Thanks [@ajspetner](https://github.com/ajspetner)! - Added grok-4-1-fast-reasoning and grok-4-1-fast-non-reasoning models

## 4.122.0

### Minor Changes

- [#3609](https://github.com/Kilo-Org/kilocode/pull/3609) [`65191fd`](https://github.com/Kilo-Org/kilocode/commit/65191fd671e3b4b376efe572b4e605dbf9d3a5d2) Thanks [@mcowger](https://github.com/mcowger)! - Synthetic provider to use updated models endpoint and dynamic fetcher

- [#3674](https://github.com/Kilo-Org/kilocode/pull/3674) [`cdd439a`](https://github.com/Kilo-Org/kilocode/commit/cdd439a098f0b1ccb75f8b8cad53a35494e6ab29) Thanks [@mental-lab](https://github.com/mental-lab)! - Kilo Code can now delete files and directories without using command line tools.

### Patch Changes

- [#3925](https://github.com/Kilo-Org/kilocode/pull/3925) [`02abc84`](https://github.com/Kilo-Org/kilocode/commit/02abc84c41e4a12dd45ff15d003ce8fbb4a6bfed) Thanks [@jrf0110](https://github.com/jrf0110)! - Improve organization/managed indexing performance

## 4.122.1

### Patch Changes

- [#4000](https://github.com/Kilo-Org/kilocode/pull/4000) [`3ef2237`](https://github.com/Kilo-Org/kilocode/commit/3ef2237493f48ac212732a5b7d67eceb4af0d594) Thanks [@brianc](https://github.com/brianc)! - There was previously some debug log spam introduced for the Managed Indexing feature. This change removes those logs.

- [#4005](https://github.com/Kilo-Org/kilocode/pull/4005) [`5aa56df`](https://github.com/Kilo-Org/kilocode/commit/5aa56df5123d33ba0ecadeabb3727b57974a842e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add Claude Opus 4.5 support, including verbosity controls for Kilo Gateway, OpenRouter and Anthropic providers

## 4.123.0

### Minor Changes

- [#3020](https://github.com/Kilo-Org/kilocode/pull/3020) [`147786c`](https://github.com/Kilo-Org/kilocode/commit/147786c81238c1adea9c2bddf649d0763dd449d2) Thanks [@CaiDingxian](https://github.com/CaiDingxian)! - Add independent provider setup for Fast Apply feature

### Patch Changes

- [#4019](https://github.com/Kilo-Org/kilocode/pull/4019) [`f16c31b`](https://github.com/Kilo-Org/kilocode/commit/f16c31bf921a642e23d54fb2dfd768e07be8de71) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add Opus 4.5 to Claude Code provider

- [#3445](https://github.com/Kilo-Org/kilocode/pull/3445) [`8065f7a`](https://github.com/Kilo-Org/kilocode/commit/8065f7a44958ec2584ee591d7e936eacdfe73951) Thanks [@jeanduplessis](https://github.com/jeanduplessis)! - fix: apply file limit after .kilocodeignore filtering instead of before

- [#3988](https://github.com/Kilo-Org/kilocode/pull/3988) [`a169e6f`](https://github.com/Kilo-Org/kilocode/commit/a169e6fb0632f06b3271fdcb03d01d5ab7eebd69) Thanks [@dltechy](https://github.com/dltechy)! - Fix an issue where workflows are not working except as the initial prompt of a task

## 4.124.0

### Minor Changes

- [#2587](https://github.com/Kilo-Org/kilocode/pull/2587) [`f3de1e7`](https://github.com/Kilo-Org/kilocode/commit/f3de1e713c3a61fe04a30aa26e33ef7431ed63f4) Thanks [@NaccOll](https://github.com/NaccOll)! - Add LanceDB vector store support

### Patch Changes

- [#4045](https://github.com/Kilo-Org/kilocode/pull/4045) [`b14afb1`](https://github.com/Kilo-Org/kilocode/commit/b14afb11363a62d45d1feb176d9b5054d75d43a9) Thanks [@eshurakov](https://github.com/eshurakov)! - Nano GPT provider support (by @b3nw)

- [#4023](https://github.com/Kilo-Org/kilocode/pull/4023) [`5af4d01`](https://github.com/Kilo-Org/kilocode/commit/5af4d01b3e0d4467e8234c1c445d098c1f6756f2) Thanks [@markijbema](https://github.com/markijbema)! - Small redesign of the autocomplete statusbar/tooltip

## 4.125.0

### Minor Changes

- [#2827](https://github.com/Kilo-Org/kilocode/pull/2827) [`c7793db`](https://github.com/Kilo-Org/kilocode/commit/c7793dbd44371431f68deb76863af5f0c21375f4) Thanks [@bea-leanix](https://github.com/bea-leanix)! - Added SAP AI Core provider

- [#3895](https://github.com/Kilo-Org/kilocode/pull/3895) [`f5d3459`](https://github.com/Kilo-Org/kilocode/commit/f5d34595f3a8c9436fb870b5f22bb8094db9f3c5) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.30.1-v3.32.0

    - Feature: Support for OpenAI Responses 24 hour prompt caching (PR #9259 by @hannesrudolph)
    - Fix: OpenAI Native encrypted_content handling and remove gpt-5-chat-latest verbosity flag (#9225 by @politsin, PR by @hannesrudolph)
    - Refactor: Rename sliding-window to context-management and truncateConversationIfNeeded to manageContext (thanks @hannesrudolph!)
    - Fix: Apply updated API profile settings when provider/model unchanged (#9208 by @hannesrudolph, PR by @hannesrudolph)
    - Migrate conversation continuity to plugin-side encrypted reasoning items using Responses API for improved reliability (thanks @hannesrudolph!)
    - Fix: Include mcpServers in getState() for auto-approval (#9190 by @bozoweed, PR by @daniel-lxs)
    - Batch settings updates from the webview to the extension host for improved performance (thanks @cte!)
    - Fix: Replace rate-limited badges with badgen.net to improve README reliability (thanks @daniel-lxs!)
    - Fix: Prevent command_output ask from blocking in cloud/headless environments (thanks @daniel-lxs!)
    - Fix: Model switch re-applies selected profile, ensuring task configuration stays in sync (#9179 by @hannesrudolph, PR by @hannesrudolph)
    - Move auto-approval logic from `ChatView` to `Task` for better architecture (thanks @cte!)
    - Add custom Button component with variant system (thanks @brunobergher!)
    - Improvements to to-do lists and task headers (thanks @brunobergher!)
    - Fix: Prevent crash when streaming chunks have null choices array (thanks @daniel-lxs!)
    - Fix: Prevent context condensing on settings save when provider/model unchanged (#4430 by @hannesrudolph, PR by @daniel-lxs)
    - Fix: Respect custom OpenRouter URL for all API operations (#8947 by @sstraus, PR by @roomote)
    - Fix: Auto-retry on empty assistant response to prevent task failures (#9076 by @Akillatech, PR by @daniel-lxs)
    - Fix: Use system role for OpenAI Compatible provider when streaming is disabled (#8215 by @whitfin, PR by @roomote)
    - Fix: Prevent notification sound on attempt_completion with queued messages (#8537 by @hannesrudolph, PR by @roomote)
    - Feat: Auto-switch to imported mode with architect fallback for better mode detection (#8239 by @hannesrudolph, PR by @daniel-lxs)
    - Feat: Improve diff appearance in main chat view (thanks @hannesrudolph!)
    - UX: Home screen visuals (thanks @brunobergher!)
    - Fix: eliminate UI flicker during task cancellation (thanks @daniel-lxs!)
    - Add Global Inference support for Bedrock models (#8750 by @ronyblum, PR by @hannesrudolph)
    - Add Qwen3 embedding models (0.6B and 4B) to OpenRouter support (#9058 by @dmarkey, PR by @app/roomote)
    - Fix: keep pinned models fixed at top of scrollable list (#8812 by @XiaoYingYo, PR by @app/roomote)
    - Fix: update Opus 4.1 max tokens from 8K to 32K (#9045 by @kaveh-deriv, PR by @app/roomote)
    - Set Claude Sonnet 4.5 as default for key providers (thanks @hannesrudolph!)
    - Fix: dynamic provider model validation to prevent cross-contamination (#9047 by @NotADev137, PR by @daniel-lxs)
    - Fix: Bedrock user agent to report full SDK details (#9031 by @ajjuaire, PR by @ajjuaire)
    - Add file path tooltips with centralized PathTooltip component (#8278 by @da2ce7, PR by @daniel-lxs)
    - Fix: Correct OpenRouter Mistral model embedding dimension from 3072 to 1536 (thanks @daniel-lxs!)

- [#3868](https://github.com/Kilo-Org/kilocode/pull/3868) [`cf6ed3e`](https://github.com/Kilo-Org/kilocode/commit/cf6ed3ed3bc7dfe0268121f3e68d422f3ffadfff) Thanks [@iscekic](https://github.com/iscekic)! - add sessions support

### Patch Changes

- [#4059](https://github.com/Kilo-Org/kilocode/pull/4059) [`d47a3d5`](https://github.com/Kilo-Org/kilocode/commit/d47a3d52dfbf669fdf50be53c416b060cd537e40) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix error on task resumption with some providers when native tool calls are enabled

- [#3565](https://github.com/Kilo-Org/kilocode/pull/3565) [`4a05694`](https://github.com/Kilo-Org/kilocode/commit/4a05694ac84007397a2b99c826151d6383506001) Thanks [@marcus-v-rodrigues](https://github.com/marcus-v-rodrigues)! - Fix 403 error for Gemini CLI by removing 'default' project fallback

- [#2540](https://github.com/Kilo-Org/kilocode/pull/2540) [`591da2b`](https://github.com/Kilo-Org/kilocode/commit/591da2b8dae2d4c72c0663302e19dfe6e30b1617) Thanks [@gerardbalaoro](https://github.com/gerardbalaoro)! - Support for MCP servers in `.cursor/mcp.json`

- [#2324](https://github.com/Kilo-Org/kilocode/pull/2324) [`ab9b94b`](https://github.com/Kilo-Org/kilocode/commit/ab9b94b0d593bccd222c5cbb7fdffe968d4c6a40) Thanks [@mikkihugo](https://github.com/mikkihugo)! - Add VS Code Settings Sync integration

- [#3193](https://github.com/Kilo-Org/kilocode/pull/3193) [`6a895de`](https://github.com/Kilo-Org/kilocode/commit/6a895dec08d6afccb21dc431c021200f52c4c7cf) Thanks [@siulong](https://github.com/siulong)! - Fix rules folder path when deleting the rules

- [#3804](https://github.com/Kilo-Org/kilocode/pull/3804) [`5d4b38b`](https://github.com/Kilo-Org/kilocode/commit/5d4b38b67ed670da1de651de0491906a594174ac) Thanks [@skridlevsky](https://github.com/skridlevsky)! - fix(settings): codebase indexing toggle not persisting

- [#3484](https://github.com/Kilo-Org/kilocode/pull/3484) [`ac01ae3`](https://github.com/Kilo-Org/kilocode/commit/ac01ae30e735502b6cb265f79ab6f82bf954fb52) Thanks [@mental-lab](https://github.com/mental-lab)! - Add warning for ANTHROPIC_API_KEY conflicts with Claude Code provider

- [#3087](https://github.com/Kilo-Org/kilocode/pull/3087) [`ebab11b`](https://github.com/Kilo-Org/kilocode/commit/ebab11b033dd354c175a4027657446b745a82d96) Thanks [@jinhan1414](https://github.com/jinhan1414)! - Unify slash command parsing and expand mention detection

## 4.125.1

### Patch Changes

- [#4057](https://github.com/Kilo-Org/kilocode/pull/4057) [`c2a7407`](https://github.com/Kilo-Org/kilocode/commit/c2a7407e8964c5fa8114d17ab5a6936b81c785ab) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code sidebar no longer steals focus on startup when managed codebase indexing is active

## 4.126.0

### Minor Changes

- [#4026](https://github.com/Kilo-Org/kilocode/pull/4026) [`a44ec02`](https://github.com/Kilo-Org/kilocode/commit/a44ec024347d345f46bf01486a6913f0e1e5a8c2) Thanks [@quantizoor](https://github.com/quantizoor)! - Add possibility to specify Azure deployment name for Anthropic models

## 4.126.1

### Patch Changes

- [#4114](https://github.com/Kilo-Org/kilocode/pull/4114) [`ac020d6`](https://github.com/Kilo-Org/kilocode/commit/ac020d600e5034ca025b71213aa64c5629cab219) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix profile editing when adjusting non-activated profile

## 4.127.0

### Minor Changes

- [#4129](https://github.com/Kilo-Org/kilocode/pull/4129) [`a2d5b29`](https://github.com/Kilo-Org/kilocode/commit/a2d5b29ce79853e6a98cb30b86af1844b6023833) Thanks [@brianc](https://github.com/brianc)! - Managed Code Indexing UI internals updated. Removed optionality in the UI, included link to backend management UI, and improved architecture for better incremental status and error reporting.

- [#4066](https://github.com/Kilo-Org/kilocode/pull/4066) [`1831796`](https://github.com/Kilo-Org/kilocode/commit/18317963fbb5b02a1178f4579d5cb643cfbd531c) Thanks [@iscekic](https://github.com/iscekic)! - use shared session manager from extension folder

### Patch Changes

- [#4128](https://github.com/Kilo-Org/kilocode/pull/4128) [`29fbec0`](https://github.com/Kilo-Org/kilocode/commit/29fbec0b6a9feb4bc79ba819a164b45ccec236bb) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: show diff buttons after task completion

- [#4120](https://github.com/Kilo-Org/kilocode/pull/4120) [`ebe1667`](https://github.com/Kilo-Org/kilocode/commit/ebe1667e8160a809a82f561627ce5494fa8808d3) Thanks [@iscekic](https://github.com/iscekic)! - increase session sync interval to 3s

- [#4071](https://github.com/Kilo-Org/kilocode/pull/4071) [`d5e89a1`](https://github.com/Kilo-Org/kilocode/commit/d5e89a141e8736902c6dcb2e8ab253cc8590abe7) Thanks [@inj-src](https://github.com/inj-src)! - Added support for Gemini 3 Pro Preview to Gemini CLI provider and removed deprecated models

- [#4137](https://github.com/Kilo-Org/kilocode/pull/4137) [`119e31b`](https://github.com/Kilo-Org/kilocode/commit/119e31b610f24621ae91731ce1596b6cded0ec24) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Slightly improved reliability of Opus with Claude Code

- [#4149](https://github.com/Kilo-Org/kilocode/pull/4149) [`04497da`](https://github.com/Kilo-Org/kilocode/commit/04497dabeafffd7b1f1f8ab94e66198884c1390c) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix for double id's stored in profiles when activating a new profile and then adding a new one

## 4.128.0

### Minor Changes

- [#4165](https://github.com/Kilo-Org/kilocode/pull/4165) [`6e9ff79`](https://github.com/Kilo-Org/kilocode/commit/6e9ff7910ba1b51b1e460ce3c7d63e66d803cb70) Thanks [@EamonNerbonne](https://github.com/EamonNerbonne)! - Add separate "Delete" auto-approve option

## 4.129.0

### Minor Changes

- [#4171](https://github.com/Kilo-Org/kilocode/pull/4171) [`b4b086b`](https://github.com/Kilo-Org/kilocode/commit/b4b086b8520192685e6c262202ecd1863abf1af1) Thanks [@brianc](https://github.com/brianc)! - Fix: prevent crash-loop if ManagedIndexer fails to instantiate.

- [#4145](https://github.com/Kilo-Org/kilocode/pull/4145) [`230bcec`](https://github.com/Kilo-Org/kilocode/commit/230bcec1cdb77bffad06c05aff1e33a908b077b8) Thanks [@iscekic](https://github.com/iscekic)! - add session sharing and forking

### Patch Changes

- [#4145](https://github.com/Kilo-Org/kilocode/pull/4145) [`230bcec`](https://github.com/Kilo-Org/kilocode/commit/230bcec1cdb77bffad06c05aff1e33a908b077b8) Thanks [@iscekic](https://github.com/iscekic)! - update shared session url

## 4.130.0

### Minor Changes

- [#4131](https://github.com/Kilo-Org/kilocode/pull/4131) [`9a2ef51`](https://github.com/Kilo-Org/kilocode/commit/9a2ef512bb50143b6cff690f912f7fd8dcfa65b7) Thanks [@mcowger](https://github.com/mcowger)! - Fix tool parsing failure in write_to_file with JSON contents

## 4.130.1

### Patch Changes

- [#4222](https://github.com/Kilo-Org/kilocode/pull/4222) [`fffff4d`](https://github.com/Kilo-Org/kilocode/commit/fffff4d73ec8168443e06b9dc1cfcfebfdbf58fb) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Jetbrains webview

- [#4176](https://github.com/Kilo-Org/kilocode/pull/4176) [`a71ee92`](https://github.com/Kilo-Org/kilocode/commit/a71ee92a8a35494a7693748951386c32e24b43ca) Thanks [@iscekic](https://github.com/iscekic)! - adds the /session show command

- [#4227](https://github.com/Kilo-Org/kilocode/pull/4227) [`652ddda`](https://github.com/Kilo-Org/kilocode/commit/652ddda991e79ce8bcf4f9bf8af97b0c7a610bbc) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix VSCode webview assets

- [#4204](https://github.com/Kilo-Org/kilocode/pull/4204) [`c200579`](https://github.com/Kilo-Org/kilocode/commit/c2005792b71ff8ea8d2e15286575294eb079066f) Thanks [@iscekic](https://github.com/iscekic)! - fixes session cleanup race conditions

## 4.131.0

### Minor Changes

- [#4083](https://github.com/Kilo-Org/kilocode/pull/4083) [`5696916`](https://github.com/Kilo-Org/kilocode/commit/5696916cb3e24175e3d48dff15d2609126d2c3d0) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.32.1-v3.34.7

    - Enable native tool calling for Moonshot models (PR #9646 by @mrubens)
    - Fix: OpenRouter tool calls handling improvements (PR #9642 by @mrubens)
    - Fix: OpenRouter GPT-5 strict schema validation for read_file tool (PR #9633 by @daniel-lxs)
    - Fix: Create parent directories early in write_to_file to prevent ENOENT errors (#9634 by @ivanenev, PR #9640 by @daniel-lxs)
    - Fix: Disable native tools and temperature support for claude-code provider (PR #9643 by @hannesrudolph)
    - Add 'taking you to cloud' screen after provider welcome for improved onboarding (PR #9652 by @mrubens)
    - Add support for AWS Bedrock embeddings in code indexing (#8658 by @kyle-hobbs, PR #9475 by @ggoranov-smar)
    - Add native tool calling support for Mistral provider (PR #9625 by @hannesrudolph)
    - Wire MULTIPLE_NATIVE_TOOL_CALLS experiment to OpenAI parallel_tool_calls for parallel tool execution (PR #9621 by @hannesrudolph)
    - Add fine grained tool streaming for OpenRouter Anthropic (PR #9629 by @mrubens)
    - Allow global inference selection for Bedrock when cross-region is enabled (PR #9616 by @roomote)
    - Fix: Filter non-Anthropic content blocks before sending to Vertex API (#9583 by @cardil, PR #9618 by @hannesrudolph)
    - Fix: Restore content undefined check in WriteToFileTool.handlePartial() (#9611 by @Lissanro, PR #9614 by @daniel-lxs)
    - Fix: Prevent model cache from persisting empty API responses (#9597 by @zx2021210538, PR #9623 by @daniel-lxs)
    - Fix: Exclude access_mcp_resource tool when MCP has no resources (PR #9615 by @daniel-lxs)
    - Fix: Update default settings for inline terminal and codebase indexing (PR #9622 by @roomote)
    - Fix: Convert line_ranges strings to lineRanges objects in native tool calls (PR #9627 by @daniel-lxs)
    - Fix: Defer new_task tool_result until subtask completes for native protocol (PR #9628 by @daniel-lxs)
    - Experimental feature to enable multiple native tool calls per turn (PR #9273 by @daniel-lxs)
    - Add Bedrock Opus 4.5 to global inference model list (PR #9595 by @roomote)
    - Fix: Update API handler when toolProtocol changes (PR #9599 by @mrubens)
    - Make single file read only apply to XML tools (PR #9600 by @mrubens)
    - Add new Black Forest Labs image generation models, available on OpenRouter (PR #9587 and #9589 by @mrubens)
    - Fix: Preserve dynamic MCP tool names in native mode API history to prevent tool name mismatches (PR #9559 by @daniel-lxs)
    - Fix: Preserve tool_use blocks in summary message during condensing with native tools to maintain conversation context (PR #9582 by @daniel-lxs)
    - Implement streaming for native tool calls, providing real-time feedback during tool execution (PR #9542 by @daniel-lxs)
    - Fix ask_followup_question streaming issue and add missing tool cases (PR #9561 by @daniel-lxs)
    - Switch from asdf to mise-en-place in bare-metal evals setup script (PR #9548 by @cte)
    - Fix: Gracefully skip unsupported content blocks in Gemini transformer (PR #9537 by @daniel-lxs)
    - Fix: Flush LiteLLM cache when credentials change on refresh (PR #9536 by @daniel-lxs)
    - Fix: Ensure XML parser state matches tool protocol on config update (PR #9535 by @daniel-lxs)
    - Fix: Support reasoning_details format for Gemini 3 models (PR #9506 by @daniel-lxs)
    - Show the prompt for image generation in the UI (PR #9505 by @mrubens)
    - Fix double todo list display issue (PR #9517 by @mrubens)
    - Add Browser Use 2.0 with enhanced browser interaction capabilities (PR #8941 by @hannesrudolph)
    - Add support for Baseten as a new AI provider (PR #9461 by @AlexKer)
    - Improve base OpenAI compatible provider with better error handling and configuration (PR #9462 by @mrubens)
    - Add provider-oriented welcome screen to improve onboarding experience (PR #9484 by @mrubens)
    - Enhance native tool descriptions with examples and clarifications for better AI understanding (PR #9486 by @daniel-lxs)
    - Fix: Make cancel button immediately responsive during streaming (#9435 by @jwadow, PR #9448 by @daniel-lxs)
    - Fix: Resolve apply_diff performance regression from earlier changes (PR #9474 by @daniel-lxs)
    - Fix: Implement model cache refresh to prevent stale disk cache issues (PR #9478 by @daniel-lxs)
    - Fix: Copy model-level capabilities to OpenRouter endpoint models correctly (PR #9483 by @daniel-lxs)
    - Fix: Add fallback to yield tool calls regardless of finish_reason (PR #9476 by @daniel-lxs)
    - Store reasoning in conversation history for all providers (PR #9451 by @daniel-lxs)
    - Fix: Improve preserveReasoning flag to control API reasoning inclusion (PR #9453 by @daniel-lxs)
    - Fix: Prevent OpenAI Native parallel tool calls for native tool calling (PR #9433 by @hannesrudolph)
    - Fix: Improve search and replace symbol parsing (PR #9456 by @daniel-lxs)
    - Fix: Send tool_result blocks for skipped tools in native protocol (PR #9457 by @daniel-lxs)
    - Fix: Improve markdown formatting and add reasoning support (PR #9458 by @daniel-lxs)
    - Fix: Prevent duplicate environment_details when resuming cancelled tasks (PR #9442 by @daniel-lxs)
    - Improve read_file tool description with examples (PR #9422 by @daniel-lxs)
    - Update glob dependency to ^11.1.0 (PR #9449 by @jr)
    - Update tar-fs to 3.1.1 via pnpm override (PR #9450 by @app/roomote)
    - Add RCC credit balance display (PR #9386 by @jr)
    - Fix: Preserve user images in native tool call results (PR #9401 by @daniel-lxs)
    - Perf: Reduce excessive getModel() calls and implement disk cache fallback (PR #9410 by @daniel-lxs)
    - Show zero price for free models (PR #9419 by @mrubens)
    - Fix: Resolve native tool protocol race condition causing 400 errors (PR #9363 by @daniel-lxs)
    - Fix: Update tools to return structured JSON for native protocol (PR #9373 by @daniel-lxs)
    - Fix: Include nativeArgs in tool repetition detection (PR #9377 by @daniel-lxs)
    - Fix: Ensure no XML parsing when protocol is native (PR #9371 by @daniel-lxs)
    - Fix: Gemini maxOutputTokens and reasoning config (PR #9375 by @hannesrudolph)
    - Fix: Gemini thought signature validation and token counting errors (PR #9380 by @hannesrudolph)
    - Fix: Exclude XML tool examples from MODES section when native protocol enabled (PR #9367 by @daniel-lxs)
    - Retry eval tasks if API instability detected (PR #9365 by @cte)
    - Add toolProtocol property to PostHog tool usage telemetry (PR #9374 by @app/roomote)
    - Improve Google Gemini defaults with better temperature and cost reporting (PR #9327 by @hannesrudolph)
    - Add git status information to environment details (PR #9310 by @daniel-lxs)
    - Add tool protocol selector to advanced settings (PR #9324 by @daniel-lxs)
    - Implement dynamic tool protocol resolution with proper precedence hierarchy (PR #9286 by @daniel-lxs)
    - Move Import/Export functionality to Modes view toolbar and cleanup Mode Edit view (PR #9077 by @hannesrudolph)
    - Fix: Prevent duplicate tool_result blocks in native tool protocol (PR #9248 by @daniel-lxs)
    - Fix: Format tool responses properly for native protocol (PR #9270 by @daniel-lxs)
    - Fix: Centralize toolProtocol configuration checks (PR #9279 by @daniel-lxs)
    - Fix: Preserve tool blocks for native protocol in conversation history (PR #9319 by @daniel-lxs)
    - Fix: Prevent infinite loop when task_done succeeds (PR #9325 by @daniel-lxs)
    - Fix: Sync parser state with profile/model changes (PR #9355 by @daniel-lxs)
    - Fix: Pass tool protocol parameter to lineCountTruncationError (PR #9358 by @daniel-lxs)
    - Use VSCode theme color for outline button borders (PR #9336 by @app/roomote)
    - Fix: Add abort controller for request cancellation in OpenAI native protocol (PR #9276 by @daniel-lxs)
    - Fix: Resolve duplicate tool blocks causing 'tool has already been used' error in native protocol mode (PR #9275 by @daniel-lxs)
    - Fix: Prevent duplicate tool_result blocks in native protocol mode for read_file (PR #9272 by @daniel-lxs)
    - Fix: Correct OpenAI Native handling of encrypted reasoning blocks to prevent errors during condensing (PR #9263 by @hannesrudolph)
    - Fix: Disable XML parser for native tool protocol to prevent parsing conflicts (PR #9277 by @daniel-lxs)

### Patch Changes

- [#4211](https://github.com/Kilo-Org/kilocode/pull/4211) [`489b366`](https://github.com/Kilo-Org/kilocode/commit/489b3669c34f437dfd7c4b9a692cf7d84fff73a1) Thanks [@iscekic](https://github.com/iscekic)! - refactor session manager to better handle asynchronicity of file save events

## 4.131.1

### Patch Changes

- [#4278](https://github.com/Kilo-Org/kilocode/pull/4278) [`a389603`](https://github.com/Kilo-Org/kilocode/commit/a3896030e963d4c94200716035cce446e838be35) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix webview assets build

- [#4275](https://github.com/Kilo-Org/kilocode/pull/4275) [`ce50373`](https://github.com/Kilo-Org/kilocode/commit/ce50373dd6ff4f011783e2f44dd41e6a9b77a8d3) Thanks [@iscekic](https://github.com/iscekic)! - use new endpoint for uploading session blobs via presigned r2 urls

- [#4270](https://github.com/Kilo-Org/kilocode/pull/4270) [`bdb7ed4`](https://github.com/Kilo-Org/kilocode/commit/bdb7ed4f2a148b297a21c39457fe13ddc38de3de) Thanks [@iscekic](https://github.com/iscekic)! - fix an issue where a session was duplicated instead of restored

## 4.131.2

### Patch Changes

- [#4281](https://github.com/Kilo-Org/kilocode/pull/4281) [`e0ed242`](https://github.com/Kilo-Org/kilocode/commit/e0ed24298b6dc33b8f1c52124b613503d85498aa) Thanks [@iscekic](https://github.com/iscekic)! - force release workflow run

## 4.132.0

### Minor Changes

- [#4305](https://github.com/Kilo-Org/kilocode/pull/4305) [`e7b0aa2`](https://github.com/Kilo-Org/kilocode/commit/e7b0aa2290cbffef7aeb66b8bbcbf2ca71bcdb28) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add Agent Manager for running multiple Kilo Code agents in parallel from a single panel.

### Patch Changes

- [#4117](https://github.com/Kilo-Org/kilocode/pull/4117) [`2224b90`](https://github.com/Kilo-Org/kilocode/commit/2224b90019f9cc1efacd2e638902732fc6aade02) Thanks [@ShirleyRex](https://github.com/ShirleyRex)! - fix chat textarea autoscroll to keep caret visible

- [#4304](https://github.com/Kilo-Org/kilocode/pull/4304) [`8ca99f4`](https://github.com/Kilo-Org/kilocode/commit/8ca99f433810c188707c97ace90f5bbf82406d3c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed an issue that caused the Kilo Gateway model list to never refresh

- [#4288](https://github.com/Kilo-Org/kilocode/pull/4288) [`32efaf2`](https://github.com/Kilo-Org/kilocode/commit/32efaf2e79a5203cb85732316baa92d056b0c5a1) Thanks [@pandemicsyn](https://github.com/pandemicsyn)! - Begin emitting session_synced event

## 4.133.0

### Minor Changes

- [#4317](https://github.com/Kilo-Org/kilocode/pull/4317) [`797c959`](https://github.com/Kilo-Org/kilocode/commit/797c9594a527f19e0d39b7402fb031cd9eb4e2a7) Thanks [@iscekic](https://github.com/iscekic)! - add session versioning

### Patch Changes

- [#3571](https://github.com/Kilo-Org/kilocode/pull/3571) [`ea2702c`](https://github.com/Kilo-Org/kilocode/commit/ea2702c6f29e7ff2bfe55714716f72bb43cfbede) Thanks [@yadue](https://github.com/yadue)! - Add batch size and number of retries to the indexing options

- [#4310](https://github.com/Kilo-Org/kilocode/pull/4310) [`e5e6085`](https://github.com/Kilo-Org/kilocode/commit/e5e6085d1f9b4f142130eddd3eaddb52bd5cde17) Thanks [@iscekic](https://github.com/iscekic)! - check token before syncing session

- [#4272](https://github.com/Kilo-Org/kilocode/pull/4272) [`3ad35d9`](https://github.com/Kilo-Org/kilocode/commit/3ad35d94a5560ca1b87b2b393c6d064703c144d4) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: reset state errors when clearing indexing state

## 4.134.0

### Minor Changes

- [#4330](https://github.com/Kilo-Org/kilocode/pull/4330) [`57dc5a9`](https://github.com/Kilo-Org/kilocode/commit/57dc5a9379b25eb2e1f9902486ff71db731a5aaf) Thanks [@catrielmuller](https://github.com/catrielmuller)! - JetBrains IDEs: Autocomplete is now available and can be enabled in Settings > Autocomplete.

- [#4178](https://github.com/Kilo-Org/kilocode/pull/4178) [`414282a`](https://github.com/Kilo-Org/kilocode/commit/414282a5a5c6cdfe528c3a7775bf07cd3e0739aa) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Added a new device authorization flow for Kilo Gateway that makes it easier to connect your editor to your Kilo account. Instead of manually copying API tokens, you can now:

    - Scan a QR code with your phone or click to open the authorization page in your browser
    - Approve the connection from your browser
    - Automatically get authenticated without copying any tokens

    This streamlined workflow provides a more secure and user-friendly way to authenticate, similar to how you connect devices to services like Netflix or YouTube.

- [#4334](https://github.com/Kilo-Org/kilocode/pull/4334) [`5bdab7c`](https://github.com/Kilo-Org/kilocode/commit/5bdab7caca867970a5ee7faccfb76e36e01c6471) Thanks [@brianc](https://github.com/brianc)! - Updated managed indexing gate logic to be able to roll it out to individuals instead of just organizations.

- [#3999](https://github.com/Kilo-Org/kilocode/pull/3999) [`7f349d0`](https://github.com/Kilo-Org/kilocode/commit/7f349d04749f74a9b84de8cb68f44d8d8d71cbc5) Thanks [@hassoncs](https://github.com/hassoncs)! - Add Autocomplete support to the chat text box. It can be enabled/disabled using a new toggle in the autocomplete settings menu

### Patch Changes

- [#4327](https://github.com/Kilo-Org/kilocode/pull/4327) [`52fc352`](https://github.com/Kilo-Org/kilocode/commit/52fc3524151f30d3925408d30fd8af9265890b77) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - fix agent creation getting stuck when CLI doesn't respond with session_created event

- [#4182](https://github.com/Kilo-Org/kilocode/pull/4182) [`33c9eab`](https://github.com/Kilo-Org/kilocode/commit/33c9eabd2ef395e585f37542980e996054bf3fcb) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Fix open external urls

## 4.135.0

### Minor Changes

- [#4326](https://github.com/Kilo-Org/kilocode/pull/4326) [`6d62090`](https://github.com/Kilo-Org/kilocode/commit/6d620905dfc6d8419bdbc9ffcad54109057e709e) Thanks [@iscekic](https://github.com/iscekic)! - improve session sync mechanism (event based instead of timer)

- [#4333](https://github.com/Kilo-Org/kilocode/pull/4333) [`0093fd1`](https://github.com/Kilo-Org/kilocode/commit/0093fd15e1a3baa80a872bc8889c5e219684004c) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.36.2

    - Restrict GPT-5 tool set to apply_patch for improved compatibility (PR #9853 by @hannesrudolph)
    - Fix: Resolve Chutes provider model fetching issue (PR #9854 by @cte)
    - Add MessageManager layer for centralized history coordination, fixing message synchronization issues (PR #9842 by @hannesrudolph)
    - Fix: Prevent cascading truncation loop by only truncating visible messages (PR #9844 by @hannesrudolph)
    - Fix: Handle unknown/invalid native tool calls to prevent extension freeze (PR #9834 by @daniel-lxs)
    - Always enable reasoning for models that require it (PR #9836 by @cte)
    - ChatView: Smoother stick-to-bottom behavior during streaming (PR #8999 by @hannesrudolph)
    - UX: Improved error messages and documentation links (PR #9777 by @brunobergher)
    - Fix: Overly round follow-up question suggestions styling (PR #9829 by @brunobergher)
    - Ignore input to the execa terminal process for safer command execution (PR #9827 by @mrubens)
    - Be safer about large file reads (PR #9843 by @jr)
    - Add gpt-5.1-codex-max model to OpenAI provider (PR #9848 by @hannesrudolph)
    - Evals UI: Add filtering, bulk delete, tool consolidation, and run notes (PR #9837 by @hannesrudolph)
    - Evals UI: Add multi-model launch and UI improvements (PR #9845 by @hannesrudolph)
    - Web: New pricing page (PR #9821 by @brunobergher)
    - Fix: Restore context when rewinding after condense (#8295 by @hannesrudolph, PR #9665 by @hannesrudolph)
    - Enable search_and_replace for Minimax models (PR #9780 by @mrubens)
    - Fix: Resolve Vercel AI Gateway model fetching issues (PR #9791 by @cte)
    - Fix: Apply conservative max tokens for Cerebras provider (PR #9804 by @sebastiand-cerebras)
    - Fix: Remove omission detection logic to eliminate false positives (#9785 by @Michaelzag, PR #9787 by @app/roomote)
    - Refactor: Remove deprecated insert_content tool (PR #9751 by @daniel-lxs)
    - Chore: Hide parallel tool calls experiment and disable feature (PR #9798 by @hannesrudolph)
    - Update next.js documentation site dependencies (PR #9799 by @jr)
    - Fix: Correct download count display on homepage (PR #9807 by @mrubens)
    - Feat: Add provider routing selection for OpenRouter embeddings (#9144 by @SannidhyaSah, PR #9693 by @SannidhyaSah)
    - Default Minimax M2 to native tool calling (PR #9778 by @mrubens)
    - Sanitize the native tool calls to fix a bug with Gemini (PR #9769 by @mrubens)
    - Fix: Handle malformed native tool calls to prevent hanging (PR #9758 by @daniel-lxs)
    - Fix: Remove reasoning toggles for GLM-4.5 and GLM-4.6 on z.ai provider (PR #9752 by @roomote)
    - Refactor: Remove line_count parameter from write_to_file tool (PR #9667 by @hannesrudolph)
    - Switch to new welcome view for improved onboarding experience (PR #9741 by @mrubens)
    - Update homepage with latest changes (PR #9675 by @brunobergher)
    - Improve privacy for stealth models by adding vendor confidentiality section to system prompt (PR #9742 by @mrubens)
    - Allow models to contain default temperature settings for provider-specific optimal defaults (PR #9734 by @mrubens)
    - Enable native tool support for all LiteLLM models by default (PR #9736 by @mrubens)
    - Pass app version to provider for improved request tracking (PR #9730 by @cte)
    - Fix: Flush pending tool results before task delegation (PR #9726 by @daniel-lxs)
    - Improve: Better IPC error logging for easier debugging (PR #9727 by @cte)
    - Metadata-driven subtasks with automatic parent resume and single-open safety for improved task orchestration (#8081 by @hannesrudolph, PR #9090 by @hannesrudolph)
    - Native tool calling support expanded across many providers: Bedrock (PR #9698 by @mrubens), Cerebras (PR #9692 by @mrubens), Chutes with auto-detection from API (PR #9715 by @daniel-lxs), DeepInfra (PR #9691 by @mrubens), DeepSeek and Doubao (PR #9671 by @daniel-lxs), Groq (PR #9673 by @daniel-lxs), LiteLLM (PR #9719 by @daniel-lxs), Ollama (PR #9696 by @mrubens), OpenAI-compatible providers (PR #9676 by @daniel-lxs), Requesty (PR #9672 by @daniel-lxs), Unbound (PR #9699 by @mrubens), Vercel AI Gateway (PR #9697 by @mrubens), Vertex Gemini (PR #9678 by @daniel-lxs), and xAI with new Grok 4 Fast and Grok 4.1 Fast models (PR #9690 by @mrubens)
    - Fix: Preserve tool_use blocks in summary for parallel tool calls (#9700 by @SilentFlower, PR #9714 by @SilentFlower)
    - Default Grok Code Fast to native tools for better performance (PR #9717 by @mrubens)
    - UX toolbar cleanup and settings consolidation for a cleaner interface (PR #9710 by @brunobergher)
    - Add model-specific tool customization via `excludedTools` and `includedTools` configuration (PR #9641 by @daniel-lxs)
    - Add new `apply_patch` native tool for more efficient file editing operations (PR #9663 by @hannesrudolph)
    - Add new `search_and_replace` tool for batch text replacements across files (PR #9549 by @hannesrudolph)
    - Add debug buttons to view API and UI history for troubleshooting (PR #9684 by @hannesrudolph)
    - Include tool format in environment details for better context awareness (PR #9661 by @mrubens)
    - Fix: Display install count in millions instead of thousands (PR #9677 by @app/roomote)
    - Fix: Prevent navigation buttons from wrapping on smaller screens (PR #9721 by @app/roomote)
    - Fix: Race condition in new_task tool for native protocol (PR #9655 by @daniel-lxs)

### Patch Changes

- [#4379](https://github.com/Kilo-Org/kilocode/pull/4379) [`37b90be`](https://github.com/Kilo-Org/kilocode/commit/37b90be866111761dd90c3a0c8f179f5be16242c) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add todo list UI to Agent Manager, displaying task progress above the chat input with a collapsible list view

- [#4266](https://github.com/Kilo-Org/kilocode/pull/4266) [`3ad7248`](https://github.com/Kilo-Org/kilocode/commit/3ad7248effa3b78f93b2f39c875735cd50b78d98) Thanks [@helloGitWorld-ctrl](https://github.com/helloGitWorld-ctrl)! - JetBrains - Improve multiproject conflicts

- [#4366](https://github.com/Kilo-Org/kilocode/pull/4366) [`11c2f87`](https://github.com/Kilo-Org/kilocode/commit/11c2f870a82b39cbbb2d3e9bcdecc8bc13b44adb) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Agent Manager: remind first-time CLI installs to run `kilocode auth` after opening the install terminal, with translations.

- [#4389](https://github.com/Kilo-Org/kilocode/pull/4389) [`ac3350e`](https://github.com/Kilo-Org/kilocode/commit/ac3350e3caff0c3c93e9f3808633d776855cefa8) Thanks [@iscekic](https://github.com/iscekic)! - fix share url handling

- [#4362](https://github.com/Kilo-Org/kilocode/pull/4362) [`d596a08`](https://github.com/Kilo-Org/kilocode/commit/d596a08d6fe5c1a719855616ba5f582407f6769a) Thanks [@iscekic](https://github.com/iscekic)! - extract an extension message handler for extension/cli reuse

- [#4361](https://github.com/Kilo-Org/kilocode/pull/4361) [`24813e9`](https://github.com/Kilo-Org/kilocode/commit/24813e900e50bf63dbb553a951970467221ce73d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Kilo Auth flow

- [#4374](https://github.com/Kilo-Org/kilocode/pull/4374) [`612e472`](https://github.com/Kilo-Org/kilocode/commit/612e47277d32eb4c481e15fa47c4216015597e88) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix styling issue on task headers

- [#4308](https://github.com/Kilo-Org/kilocode/pull/4308) [`a9eab93`](https://github.com/Kilo-Org/kilocode/commit/a9eab931b11baf20e229dd328dd47557fa29fe49) Thanks [@markijbema](https://github.com/markijbema)! - Minor tuning to autocomplete

- [#4375](https://github.com/Kilo-Org/kilocode/pull/4375) [`58c4096`](https://github.com/Kilo-Org/kilocode/commit/58c40964bb07135a0e9df29a253651a255ccffa2) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Agent Manager - Local CLI install for immutable environments

- [#4369](https://github.com/Kilo-Org/kilocode/pull/4369) [`5195bd0`](https://github.com/Kilo-Org/kilocode/commit/5195bd00067d83474606dfca0df71abfed13566a) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Agent-Manager - Fix Chat Input scroll

## 4.136.0

### Minor Changes

- [#4380](https://github.com/Kilo-Org/kilocode/pull/4380) [`802cc70`](https://github.com/Kilo-Org/kilocode/commit/802cc700a6ef4bc2f7537a4cfff1663da01982c3) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add multi-version feature to Agent Manager - launch 1-4 parallel agents in parallel on git worktrees

### Patch Changes

- [#4396](https://github.com/Kilo-Org/kilocode/pull/4396) [`b2a75e6`](https://github.com/Kilo-Org/kilocode/commit/b2a75e6013c6ec1f01a3e735c51b355a5e1e0308) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add support for GPT-5.2

## 4.137.0

### Minor Changes

- [#4394](https://github.com/Kilo-Org/kilocode/pull/4394) [`01b968b`](https://github.com/Kilo-Org/kilocode/commit/01b968ba4635a162c787169bffe1809fc1ab973a) Thanks [@hassoncs](https://github.com/hassoncs)! - Add Speech-To-Text experiment for the chat input powered by ffmpeg and the OpenAI Whisper API

- [#4388](https://github.com/Kilo-Org/kilocode/pull/4388) [`af93318`](https://github.com/Kilo-Org/kilocode/commit/af93318e3648c235721ba58fe9caab9429608241) Thanks [@iscekic](https://github.com/iscekic)! - send org id and last mode with session data

### Patch Changes

- [#4412](https://github.com/Kilo-Org/kilocode/pull/4412) [`d56879c`](https://github.com/Kilo-Org/kilocode/commit/d56879c58f65c8da1419c9840816720279bec4e6) Thanks [@quantizoor](https://github.com/quantizoor)! - Added support for xhigh reasoning effort

- [#4415](https://github.com/Kilo-Org/kilocode/pull/4415) [`5e670d1`](https://github.com/Kilo-Org/kilocode/commit/5e670d14047054a2f92a9057391286402076b5a5) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: bottom controls no longer overlap with create mode button

- [#4416](https://github.com/Kilo-Org/kilocode/pull/4416) [`026da65`](https://github.com/Kilo-Org/kilocode/commit/026da65fdb9f16d23216197412e06ca2ed208639) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - fix: resolve AbortSignal memory leak in CLI (MaxListenersExceededWarning)

- [#4392](https://github.com/Kilo-Org/kilocode/pull/4392) [`73681e9`](https://github.com/Kilo-Org/kilocode/commit/73681e9002af4c5aa3fec3bc2a86e8008dc926af) Thanks [@markijbema](https://github.com/markijbema)! - Split autocomplete suggestion in current line and next lines in most cases

- [#4426](https://github.com/Kilo-Org/kilocode/pull/4426) [`fdc0c0a`](https://github.com/Kilo-Org/kilocode/commit/fdc0c0a07d49c4726997121ad540d6c855965e7b) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix API request errors with MCP functions incompatible with OpenAI strict mode

- [#4373](https://github.com/Kilo-Org/kilocode/pull/4373) [`a80ec02`](https://github.com/Kilo-Org/kilocode/commit/a80ec02db75c061163100ce91d099f4fd3846a99) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Handle different cli authentication errors when using agent manager

## 4.138.0

### Minor Changes

- [#4472](https://github.com/Kilo-Org/kilocode/pull/4472) [`d2e82a1`](https://github.com/Kilo-Org/kilocode/commit/d2e82a115afac0467787db63d51c696d08ee102d) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Interactive agent manager worktree sessions now start without auto-execution, allowing to manually click "Finish to Branch".

- [#4428](https://github.com/Kilo-Org/kilocode/pull/4428) [`8394da8`](https://github.com/Kilo-Org/kilocode/commit/8394da8715fae4eacf416301885eeee840456700) Thanks [@iscekic](https://github.com/iscekic)! - add parent session id when creating a session

### Patch Changes

- [#4425](https://github.com/Kilo-Org/kilocode/pull/4425) [`6f70448`](https://github.com/Kilo-Org/kilocode/commit/6f70448300567b7ded997231b049346aa2718d92) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Share kilocode extension authentication directly with agent manager

- [#4475](https://github.com/Kilo-Org/kilocode/pull/4475) [`625561f`](https://github.com/Kilo-Org/kilocode/commit/625561f11669d6458729b01dcbe630a551ecfe04) Thanks [@jrf0110](https://github.com/jrf0110)! - Fixes issue on Windows where kilo code would spawn many cmd.exe windows.

- [#4376](https://github.com/Kilo-Org/kilocode/pull/4376) [`3971db3`](https://github.com/Kilo-Org/kilocode/commit/3971db3215d7339514031e094e87e9c889c9372d) Thanks [@sebastiand-cerebras](https://github.com/sebastiand-cerebras)! - Add Cerebras integration header with "kilocode" identifier to all API requests.

- [#4447](https://github.com/Kilo-Org/kilocode/pull/4447) [`0022305`](https://github.com/Kilo-Org/kilocode/commit/0022305558d71957aeb7468a0e8e3ed829997f93) Thanks [@EamonNerbonne](https://github.com/EamonNerbonne)! - Provide a few tips for when an LLM gets stuck in a loop

- [#4456](https://github.com/Kilo-Org/kilocode/pull/4456) [`85a2e31`](https://github.com/Kilo-Org/kilocode/commit/85a2e31a331157f27bfe1c9823e3326ae58779c6) Thanks [@iscekic](https://github.com/iscekic)! - correctly handle deleted tasks

- [#4476](https://github.com/Kilo-Org/kilocode/pull/4476) [`ea9413d`](https://github.com/Kilo-Org/kilocode/commit/ea9413d4fb01846b1aeb872652c92fa8e844d35f) Thanks [@hassoncs](https://github.com/hassoncs)! - Remove check for ffmpeg if the STT experiment is disabled

## 4.139.0

### Minor Changes

- [#4481](https://github.com/Kilo-Org/kilocode/pull/4481) [`61c951c`](https://github.com/Kilo-Org/kilocode/commit/61c951c0ad11d60b07406338b6053cc5d1f01cac) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Improved command output rendering in Agent Manager with new CommandExecutionBlock component that displays terminal output with status indicators, collapsible output sections, and proper escape sequence handling.

- [#4483](https://github.com/Kilo-Org/kilocode/pull/4483) [`fd639ab`](https://github.com/Kilo-Org/kilocode/commit/fd639ab78aa4ab62ea2d120bd2844d1160b20067) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add branch picker to Agent Manager for selecting base branch in worktree mode

- [#4539](https://github.com/Kilo-Org/kilocode/pull/4539) [`62a0241`](https://github.com/Kilo-Org/kilocode/commit/62a02418cafa23a733f92a9e14ba904552acdcc4) Thanks [@brianc](https://github.com/brianc)! - Improve managed indexer error handling & backoff.

### Patch Changes

- [#4512](https://github.com/Kilo-Org/kilocode/pull/4512) [`f979b56`](https://github.com/Kilo-Org/kilocode/commit/f979b56b6a631eeeb671caaca276316b63b5fb82) Thanks [@hassoncs](https://github.com/hassoncs)! - Add a tooltip explaining why speech-to-text may be unavailable

- [#4424](https://github.com/Kilo-Org/kilocode/pull/4424) [`cd0cd88`](https://github.com/Kilo-Org/kilocode/commit/cd0cd8833f0e892cc2f1c96bb24ede6254cf12c9) Thanks [@markijbema](https://github.com/markijbema)! - Added a snooze for autocomplete in the settings

- [#4519](https://github.com/Kilo-Org/kilocode/pull/4519) [`a9fd203`](https://github.com/Kilo-Org/kilocode/commit/a9fd2038ecb60fd799d164bcf1b2e4393302d15a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix text.startsWith is not a function crash

- [#4536](https://github.com/Kilo-Org/kilocode/pull/4536) [`51f4774`](https://github.com/Kilo-Org/kilocode/commit/51f4774adcb90778826e00e9a50c45bb7bf11bc8) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix image generation handler not using Kilo Gateway properly

- [#4491](https://github.com/Kilo-Org/kilocode/pull/4491) [`823b86f`](https://github.com/Kilo-Org/kilocode/commit/823b86f196868f12efc60e5acb9b385d014bc644) Thanks [@markijbema](https://github.com/markijbema)! - Prevent autocomplete from showing suggestions duplicating the previous or next line

- [#4531](https://github.com/Kilo-Org/kilocode/pull/4531) [`9413d73`](https://github.com/Kilo-Org/kilocode/commit/9413d730814d88ac67c88e6eec9a66c2c701613e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix duplicate tool processing in OpenAI-compatible provider

- [#4533](https://github.com/Kilo-Org/kilocode/pull/4533) [`20b2c29`](https://github.com/Kilo-Org/kilocode/commit/20b2c29140f401ac65d437e35c52b48329e5f52d) Thanks [@mcowger](https://github.com/mcowger)! - Add gemini-3-flash-preview model configuration to vertex models

- [#4520](https://github.com/Kilo-Org/kilocode/pull/4520) [`8342fc4`](https://github.com/Kilo-Org/kilocode/commit/8342fc4fbdc2a83601c706e734ef3377ef114f98) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Normalize line endings in search and replace tool

## 4.140.0

### Minor Changes

- [#4538](https://github.com/Kilo-Org/kilocode/pull/4538) [`459b95c`](https://github.com/Kilo-Org/kilocode/commit/459b95cbf78de10fce597e3467120e52020d1114) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Added gemini-3-flash-preview model

### Patch Changes

- [#4530](https://github.com/Kilo-Org/kilocode/pull/4530) [`782347e`](https://github.com/Kilo-Org/kilocode/commit/782347e9ed6cbaf42c88285cb8576801cd178d96) Thanks [@alvinward](https://github.com/alvinward)! - Add GLM-4.6V model support for z.ai provider

- [#4509](https://github.com/Kilo-Org/kilocode/pull/4509) [`8a9fddd`](https://github.com/Kilo-Org/kilocode/commit/8a9fddd8311633c3085516ab6255bb027aff81d6) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.36.6

    - Add tool alias support for model-specific tool customization, allowing users to configure how tools are presented to different AI models (PR #9989 by @daniel-lxs)
    - Sanitize MCP server and tool names for API compatibility, ensuring special characters don't cause issues with API calls (PR #10054 by @daniel-lxs)
    - Improve auto-approve timer visibility in follow-up suggestions for better user awareness of pending actions (PR #10048 by @brunobergher)
    - Fix: Cancel auto-approval timeout when user starts typing, preventing accidental auto-approvals during user interaction (PR #9937 by @roomote)
    - Add WorkspaceTaskVisibility type for organization cloud settings to support team visibility controls (PR #10020 by @roomote)
    - Fix: Extract raw error message from OpenRouter metadata for clearer error reporting (PR #10039 by @daniel-lxs)
    - Fix: Show tool protocol dropdown for LiteLLM provider, restoring missing configuration option (PR #10053 by @daniel-lxs)
    - Add: GPT-5.2 model to openai-native provider (PR #10024 by @hannesrudolph)
    - Fix: Handle empty Gemini responses and reasoning loops to prevent infinite retries (PR #10007 by @hannesrudolph)
    - Fix: Add missing tool_result blocks to prevent API errors when tool results are expected (PR #10015 by @daniel-lxs)
    - Fix: Filter orphaned tool_results when more results than tool_uses to prevent message validation errors (PR #10027 by @daniel-lxs)
    - Fix: Add general API endpoints for Z.ai provider (#9879 by @richtong, PR #9894 by @roomote)
    - Remove: Deprecated list_code_definition_names tool (PR #10005 by @hannesrudolph)
    - Add error details modal with on-demand display for improved error visibility when debugging issues (PR #9985 by @roomote)
    - Fix: Prevent premature rawChunkTracker clearing for MCP tools, improving reliability of MCP tool streaming (PR #9993 by @daniel-lxs)
    - Fix: Filter out 429 rate limit errors from API error telemetry for cleaner metrics (PR #9987 by @daniel-lxs)
    - Fix: Correct TODO list display order in chat view to show items in proper sequence (PR #9991 by @roomote)
    - Refactor: Unified context-management architecture with improved UX for better context control (PR #9795 by @hannesrudolph)
    - Add new `search_replace` native tool for single-replacement operations with improved editing precision (PR #9918 by @hannesrudolph)
    - Streaming tool stats and token usage throttling for better real-time feedback during generation (PR #9926 by @hannesrudolph)
    - Add versioned settings support with minPluginVersion gating for Roo provider (PR #9934 by @hannesrudolph)
    - Make Architect mode save plans to `/plans` directory and gitignore it (PR #9944 by @brunobergher)
    - Add ability to save screenshots from the browser tool (PR #9963 by @mrubens)
    - Refactor: Decouple tools from system prompt for cleaner architecture (PR #9784 by @daniel-lxs)
    - Update DeepSeek models to V3.2 with new pricing (PR #9962 by @hannesrudolph)
    - Add minimal and medium reasoning effort levels for Gemini models (PR #9973 by @hannesrudolph)
    - Update xAI models catalog with latest model options (PR #9872 by @hannesrudolph)
    - Add DeepSeek V3-2 support for Baseten provider (PR #9861 by @AlexKer)
    - Tweaks to Baseten model definitions for better defaults (PR #9866 by @mrubens)
    - Fix: Add xhigh reasoning effort support for gpt-5.1-codex-max (#9891 by @andrewginns, PR #9900 by @andrewginns)
    - Fix: Add Kimi, MiniMax, and Qwen model configurations for Bedrock (#9902 by @jbearak, PR #9905 by @app/roomote)
    - Configure tool preferences for xAI models (PR #9923 by @hannesrudolph)
    - Default to using native tools when supported on OpenRouter (PR #9878 by @mrubens)
    - Fix: Exclude apply_diff from native tools when diffEnabled is false (#9919 by @denis-kudelin, PR #9920 by @app/roomote)
    - Fix: Always show tool protocol selector for openai-compatible provider (#9965 by @bozoweed, PR #9966 by @hannesrudolph)
    - Fix: Respect explicit supportsReasoningEffort array values for proper model configuration (PR #9970 by @hannesrudolph)
    - Add timeout configuration to OpenAI Compatible Provider Client (PR #9898 by @dcbartlett)
    - Revert default tool protocol change from xml to native for stability (PR #9956 by @mrubens)
    - Improve OpenAI error messages to be more useful for debugging (PR #9639 by @mrubens)
    - Better error logs for parseToolCall exceptions (PR #9857 by @cte)
    - Improve cloud job error logging for RCC provider errors (PR #9924 by @cte)
    - Fix: Display actual API error message instead of generic text on retry (PR #9954 by @hannesrudolph)
    - Add API error telemetry to OpenRouter provider for better diagnostics (PR #9953 by @daniel-lxs)
    - Fix: Sanitize removed/invalid API providers to prevent infinite loop (PR #9869 by @hannesrudolph)
    - Fix: Use foreground color for context-management icons (PR #9912 by @hannesrudolph)
    - Fix: Suppress 'ask promise was ignored' error in handleError (PR #9914 by @daniel-lxs)
    - Fix: Process finish_reason to emit tool_call_end events properly (PR #9927 by @daniel-lxs)
    - Fix: Add finish_reason processing to xai.ts provider (PR #9929 by @daniel-lxs)
    - Fix: Validate and fix tool_result IDs before API requests (PR #9952 by @daniel-lxs)
    - Fix: Return undefined instead of 0 for disabled API timeout (PR #9960 by @hannesrudolph)
    - Stop making unnecessary count_tokens requests for better performance (PR #9884 by @mrubens)
    - Refactor: Consolidate ThinkingBudget components and fix disable handling (PR #9930 by @hannesrudolph)
    - Forbid time estimates in architect mode for more focused planning (PR #9931 by @app/roomote

- [#4568](https://github.com/Kilo-Org/kilocode/pull/4568) [`b1702cd`](https://github.com/Kilo-Org/kilocode/commit/b1702cd1c3119a89c96edf23c388b84135b8cbd3) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Remove redundant "New Agent" and "Refresh messages" buttons from agent manager session detail header.

- [#4228](https://github.com/Kilo-Org/kilocode/pull/4228) [`a128228`](https://github.com/Kilo-Org/kilocode/commit/a128228b3649924ad1fd88d040a79c6963a250bd) Thanks [@lambertjosh](https://github.com/lambertjosh)! - Change the default value of auto-approval for reading outside workspace to false

## 4.140.1

### Patch Changes

- [#4615](https://github.com/Kilo-Org/kilocode/pull/4615) [`6909640`](https://github.com/Kilo-Org/kilocode/commit/690964040770cd21248e1bea964c995d8620d8e8) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add Agent Manager terminal switching so existing session terminals are revealed when changing sessions.

- [#4586](https://github.com/Kilo-Org/kilocode/pull/4586) [`a3988cd`](https://github.com/Kilo-Org/kilocode/commit/a3988cd201f21f7b7616d68cb2bb2c0387dd91c2) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager failing to start on macOS when launched from Finder/Spotlight

- [#4561](https://github.com/Kilo-Org/kilocode/pull/4561) [`3c18860`](https://github.com/Kilo-Org/kilocode/commit/3c188603cc4d8375be4abf6e1bb9217b64e9cd2b) Thanks [@jrf0110](https://github.com/jrf0110)! - Introduces AI contribution tracking so users can better understand agentic coding impact

- [#4526](https://github.com/Kilo-Org/kilocode/pull/4526) [`10b4d6c`](https://github.com/Kilo-Org/kilocode/commit/10b4d6c02f5b310dd6e44204fa40675ca4d3d99b) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Reduce the incidence of read_file errors when using Claude models.

- [#4560](https://github.com/Kilo-Org/kilocode/pull/4560) [`5bdfe6b`](https://github.com/Kilo-Org/kilocode/commit/5bdfe6b9b68acf345e302791c15291c05a043204) Thanks [@crazyrabbit0](https://github.com/crazyrabbit0)! - chore: update Gemini Cli models and metadata

    - Added gemini-3-flash-preview model configuration.
    - Updated maxThinkingTokens for gemini-3-pro-preview to 32,768.
    - Reordered model definitions to prioritize newer versions.

- [#4596](https://github.com/Kilo-Org/kilocode/pull/4596) [`1c33884`](https://github.com/Kilo-Org/kilocode/commit/1c3388442bd9a06dcb8aed29431c138726dbedc8) Thanks [@hank9999](https://github.com/hank9999)! - Fix duplicate tool use in Anthropic

- [#4620](https://github.com/Kilo-Org/kilocode/pull/4620) [`ae6818b`](https://github.com/Kilo-Org/kilocode/commit/ae6818b5ea2d5504f9ee5eff9bdd963d9d82c51e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix duplictate tool call processing in Chutes, DeepInfra, LiteLLM and xAI providers.

- [#4597](https://github.com/Kilo-Org/kilocode/pull/4597) [`e2bb5c1`](https://github.com/Kilo-Org/kilocode/commit/e2bb5c1891b6319954b46fcca3b35807fc1f8f90) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager not showing error when CLI is misconfigured. When the CLI exits with a configuration error (e.g., missing kilocodeToken), the extension now detects this and shows an error popup with options to run `kilocode auth` or `kilocode config`.

- [#4590](https://github.com/Kilo-Org/kilocode/pull/4590) [`f2cc065`](https://github.com/Kilo-Org/kilocode/commit/f2cc0657870ae77a5720a872c9cd11b8315799b7) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - feat: add session_title_generated event emission to CLI

- [#4523](https://github.com/Kilo-Org/kilocode/pull/4523) [`e259b04`](https://github.com/Kilo-Org/kilocode/commit/e259b04037c71a9bdd9e53c174b70a975e772833) Thanks [@markijbema](https://github.com/markijbema)! - Add chat autocomplete telemetry

- [#4582](https://github.com/Kilo-Org/kilocode/pull/4582) [`3de2547`](https://github.com/Kilo-Org/kilocode/commit/3de254757049d08d3c0c100768acc564d6de4888) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Autocomplete Telemetry

- [#4488](https://github.com/Kilo-Org/kilocode/pull/4488) [`f7c3715`](https://github.com/Kilo-Org/kilocode/commit/f7c3715b4b7fea9fcd363d12bfb9467e9f169729) Thanks [@lifesized](https://github.com/lifesized)! - fix(ollama): fix model not found error and context window display

## 4.140.2

### Patch Changes

- [#4628](https://github.com/Kilo-Org/kilocode/pull/4628) [`ab0085e`](https://github.com/Kilo-Org/kilocode/commit/ab0085ea0ba6226f6adce508965302b101f60233) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Add GLM-4.7 model support to Z.ai provider

- [#4622](https://github.com/Kilo-Org/kilocode/pull/4622) [`25de94b`](https://github.com/Kilo-Org/kilocode/commit/25de94b22fc103ebb9747433444f3fef9a7eeeb8) Thanks [@alvinward](https://github.com/alvinward)! - Added model selection support below prompt for Z.ai

- [#4637](https://github.com/Kilo-Org/kilocode/pull/4637) [`b47994f`](https://github.com/Kilo-Org/kilocode/commit/b47994f0b6186490230c7eac01c5b9b75146d47a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add MiniMax-M2.1 model for MiniMax provider

## 4.140.3

### Patch Changes

- [#4648](https://github.com/Kilo-Org/kilocode/pull/4648) [`4710d11`](https://github.com/Kilo-Org/kilocode/commit/4710d119ba6ead7f0198c22ae4e902478a63867e) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager multi-version sessions to wait for pending CLI processes so terminals are available per worktree.

- [#4658](https://github.com/Kilo-Org/kilocode/pull/4658) [`e189583`](https://github.com/Kilo-Org/kilocode/commit/e1895837b7dde1b8302f3d3eb49dad2b417fc1bb) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Improve Agent Manager telemetry

- [#4647](https://github.com/Kilo-Org/kilocode/pull/4647) [`c1a0692`](https://github.com/Kilo-Org/kilocode/commit/c1a06926e838af15e4be27a476ea3e35be430551) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - fix: reduce GPU usage in Agent Manager with message virtualization

- [#4693](https://github.com/Kilo-Org/kilocode/pull/4693) [`eb5e835`](https://github.com/Kilo-Org/kilocode/commit/eb5e835be3f3c5a7cf5f7cc4baec87bfade6e2b2) Thanks [@keeganwitt](https://github.com/keeganwitt)! - Add Requesty Codestral to autocomplete provider models

- [#4659](https://github.com/Kilo-Org/kilocode/pull/4659) [`fa42cfa`](https://github.com/Kilo-Org/kilocode/commit/fa42cfaa7b77a7f410c26eaf3810808cf3631ced) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager CLI detection and Windows spawn by sanitizing shell output and running .cmd via cmd.exe.

- [#4692](https://github.com/Kilo-Org/kilocode/pull/4692) [`1401220`](https://github.com/Kilo-Org/kilocode/commit/140122089a4de591c80573306ce81cd49091b510) Thanks [@mcowger](https://github.com/mcowger)! - Fix loss of Synthetic auto model refresh

## 4.141.0

### Minor Changes

- [#4702](https://github.com/Kilo-Org/kilocode/pull/4702) [`b84a66f`](https://github.com/Kilo-Org/kilocode/commit/b84a66f5923cf2600a6d5c8e2b5fd49759406696) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add support for skills

### Patch Changes

- [#4710](https://github.com/Kilo-Org/kilocode/pull/4710) [`c128319`](https://github.com/Kilo-Org/kilocode/commit/c1283192df1b0e59fef8b9ab2d3442bf4a07abde) Thanks [@sebastiand-cerebras](https://github.com/sebastiand-cerebras)! - Update Cerebras maxTokens from 8192 to 16384 for all models

- [#4718](https://github.com/Kilo-Org/kilocode/pull/4718) [`9a465b0`](https://github.com/Kilo-Org/kilocode/commit/9a465b06fe401f70dd166fb5b320a8070f07c727) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix terminal scroll-flicker in CLI by disabling streaming output and enabling Ink incremental rendering

- [#4719](https://github.com/Kilo-Org/kilocode/pull/4719) [`57b0873`](https://github.com/Kilo-Org/kilocode/commit/57b08737788cd504954563d46eb1e6323d619301) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Confirm before exiting the CLI on Ctrl+C/Cmd+C.

## 4.141.1

### Patch Changes

- [#4736](https://github.com/Kilo-Org/kilocode/pull/4736) [`c7bd7b7`](https://github.com/Kilo-Org/kilocode/commit/c7bd7b7ad385d32e114f75dfffa6d5d4168ca073) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Skip VSCode-specific diagnostic operations in CLI mode for improved performance

- [#4725](https://github.com/Kilo-Org/kilocode/pull/4725) [`2dcce20`](https://github.com/Kilo-Org/kilocode/commit/2dcce2020b645b8c839a763d4ec97a03f8811aef) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Prevent empty checkpoints from being created on every tool use

- [#4723](https://github.com/Kilo-Org/kilocode/pull/4723) [`b9d0d16`](https://github.com/Kilo-Org/kilocode/commit/b9d0d164bd5a3feaab000a040fb9a04f4cd65f77) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Enable chat autocomplete by default

- [#4681](https://github.com/Kilo-Org/kilocode/pull/4681) [`2be56b8`](https://github.com/Kilo-Org/kilocode/commit/2be56b8b09a0cab177adf18c8dd8998f6362cc2d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains IDEs - Improve intialization process

## 4.141.2

### Patch Changes

- [#4747](https://github.com/Kilo-Org/kilocode/pull/4747) [`e4f9e65`](https://github.com/Kilo-Org/kilocode/commit/e4f9e65e130d0ef34cbf110b64b44f2156d0a425) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed no checkpoint being created before a file is edited

- [#4754](https://github.com/Kilo-Org/kilocode/pull/4754) [`d936b50`](https://github.com/Kilo-Org/kilocode/commit/d936b50f6c28592a910c83c52433eb59aa019cf5) Thanks [@keeganwitt](https://github.com/keeganwitt)! - Added ability to use Codestral for autocomplete from HuggingFace, LiteLLM, LM Studio and Ollama

## 4.142.0

### Minor Changes

- [#4587](https://github.com/Kilo-Org/kilocode/pull/4587) [`d1c35c5`](https://github.com/Kilo-Org/kilocode/commit/d1c35c54c253b22a264ee4ce90fd25f5d93343da) Thanks [@hassoncs](https://github.com/hassoncs)! - Improve the initial setup experience for the speech-to-text feature by adding an inline setup tooltip

### Patch Changes

- [#4785](https://github.com/Kilo-Org/kilocode/pull/4785) [`acc529e`](https://github.com/Kilo-Org/kilocode/commit/acc529e884be601d635ad9e714a0f3b2a4e9b639) Thanks [@markijbema](https://github.com/markijbema)! - Removed the cmd-i (quick inline task) functionality, as cmd-k-a (add to context) is now equivalent

- [#4765](https://github.com/Kilo-Org/kilocode/pull/4765) [`725b0bc`](https://github.com/Kilo-Org/kilocode/commit/725b0bc56d1262b9e847861db86a3609c40479d9) Thanks [@Drilmo](https://github.com/Drilmo)! - Fixed exit prompt showing "Cmd+C" instead of "Ctrl+C" on Mac. Ctrl+C is the universal terminal interrupt signal on all platforms.

- [#4787](https://github.com/Kilo-Org/kilocode/pull/4787) [`84033fa`](https://github.com/Kilo-Org/kilocode/commit/84033fa3015a757b358cc4799308b8209646ec5e) Thanks [@markijbema](https://github.com/markijbema)! - Keep config screen in sync with whether chat autocomplete is enabled

- [#4800](https://github.com/Kilo-Org/kilocode/pull/4800) [`c089dc2`](https://github.com/Kilo-Org/kilocode/commit/c089dc2351daefe7690adf1a3f01cc8b82a27409) Thanks [@hassoncs](https://github.com/hassoncs)! - Add fuzzy matching to / commands

## 4.143.0

### Minor Changes

- [#4643](https://github.com/Kilo-Org/kilocode/pull/4643) [`bf89c48`](https://github.com/Kilo-Org/kilocode/commit/bf89c4849342d9c0f3cfa335d65e98980d869e36) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Migrate worktree creation from CLI to extension for parallel mode sessions

### Patch Changes

- [#4804](https://github.com/Kilo-Org/kilocode/pull/4804) [`e83c30a`](https://github.com/Kilo-Org/kilocode/commit/e83c30a4160309c45bcfedf60faad3eedff0549e) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Add comprehensive AGENTS.md documentation page to Agent Behavior section

- [#4810](https://github.com/Kilo-Org/kilocode/pull/4810) [`2d8f5b4`](https://github.com/Kilo-Org/kilocode/commit/2d8f5b4f823750d22701d962ba27885b01f78acb) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Add `--append-system-prompt` CLI option to append custom instructions to the system prompt

- [#4808](https://github.com/Kilo-Org/kilocode/pull/4808) [`3253a5f`](https://github.com/Kilo-Org/kilocode/commit/3253a5f0a9ef3db176b0cc027a9a0f246faa27e6) Thanks [@markijbema](https://github.com/markijbema)! - Rename and reorganize autocomplete settings to use more familiar terminology

- [#4815](https://github.com/Kilo-Org/kilocode/pull/4815) [`1530050`](https://github.com/Kilo-Org/kilocode/commit/15300507c8febd2096282e97148e39a0bfda9e23) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Allow null for tool arguments

## 4.143.1

### Patch Changes

- [#4832](https://github.com/Kilo-Org/kilocode/pull/4832) [`22a4ebf`](https://github.com/Kilo-Org/kilocode/commit/22a4ebfcd9f885b6ef9979dc6830226db9a4f397) Thanks [@Drilmo](https://github.com/Drilmo)! - Support Cmd+V for pasting images on macOS in VSCode terminal

    - Detect empty bracketed paste (when clipboard contains image instead of text)
    - Trigger clipboard image check on empty paste or paste timeout
    - Add Cmd+V (meta key) support alongside Ctrl+V for image paste

- [#3856](https://github.com/Kilo-Org/kilocode/pull/3856) [`91e0a17`](https://github.com/Kilo-Org/kilocode/commit/91e0a1788963b8be50c58881f11ded96516ab163) Thanks [@markijbema](https://github.com/markijbema)! - Faster autocomplete when using the Mistral provider

- [#4839](https://github.com/Kilo-Org/kilocode/pull/4839) [`abaada6`](https://github.com/Kilo-Org/kilocode/commit/abaada6b7ced6d3f4e37e69441e722e453289b81) Thanks [@markijbema](https://github.com/markijbema)! - Enable autocomplete by default in the JetBrains extension

- [#4831](https://github.com/Kilo-Org/kilocode/pull/4831) [`a9cbb2c`](https://github.com/Kilo-Org/kilocode/commit/a9cbb2cebd75e0c675dc3b55e7a1653ccb93921b) Thanks [@Drilmo](https://github.com/Drilmo)! - Fix paste truncation in VSCode terminal

    - Prevent React StrictMode cleanup from interrupting paste operations
    - Remove `completePaste()` and `clearBuffers()` from useEffect cleanup
    - Paste buffer refs now persist across React re-mounts and flush properly when paste end marker is received

- [#4847](https://github.com/Kilo-Org/kilocode/pull/4847) [`8ee812a`](https://github.com/Kilo-Org/kilocode/commit/8ee812a18da5da691bf76ee5c5d9d94cfb678f25) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Disable structured outputs for Anthropic models, because the tool schema doesn't yet support it

- [#4843](https://github.com/Kilo-Org/kilocode/pull/4843) [`0e3520a`](https://github.com/Kilo-Org/kilocode/commit/0e3520a0aa9a74f7a28af1f820558d2343fd4fba) Thanks [@markijbema](https://github.com/markijbema)! - Filter unhelpful suggestions in chat autocomplete

## 4.143.2

### Patch Changes

- [#4833](https://github.com/Kilo-Org/kilocode/pull/4833) [`2c7cd08`](https://github.com/Kilo-Org/kilocode/commit/2c7cd084bf4707eedda61fed554cf15fcc8b065b) Thanks [@sebastiand-cerebras](https://github.com/sebastiand-cerebras)! - Add `zai-glm-4.7` to Cerebras models

- [#4853](https://github.com/Kilo-Org/kilocode/pull/4853) [`435c879`](https://github.com/Kilo-Org/kilocode/commit/435c879a29d55b75f5f6ffe7bf14854630e085cb) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved prompt caching when using Anthropic models on OpenRouter with native tool calling

- [#4859](https://github.com/Kilo-Org/kilocode/pull/4859) [`35fb2ad`](https://github.com/Kilo-Org/kilocode/commit/35fb2adc65dfb1e71e28f7368f96765062c43579) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Architect mode unnecessarily switching to Code mode to edit markdown files

- [#4829](https://github.com/Kilo-Org/kilocode/pull/4829) [`4e09e36`](https://github.com/Kilo-Org/kilocode/commit/4e09e36bba165a2ab6f5e07f71a420faa49ea3ec) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix browser action results displaying raw base64 screenshot data as hexadecimal garbage

## 4.144.0

### Minor Changes

- [#4888](https://github.com/Kilo-Org/kilocode/pull/4888) [`334328d`](https://github.com/Kilo-Org/kilocode/commit/334328de5fa1825726b07be5d587550de2c52d91) Thanks [@hassoncs](https://github.com/hassoncs)! - Show notifications when skills are added or removed from the project or global config

### Patch Changes

- [#4880](https://github.com/Kilo-Org/kilocode/pull/4880) [`909bca7`](https://github.com/Kilo-Org/kilocode/commit/909bca7665b91753c3a9fd0435b13f1c91bcb2f2) Thanks [@markijbema](https://github.com/markijbema)! - Fixed that some tasks in task history were red

- [#4862](https://github.com/Kilo-Org/kilocode/pull/4862) [`10ce725`](https://github.com/Kilo-Org/kilocode/commit/10ce72547d207b4f03538ebb3dc525d5bd92727d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Add Kilo icon to editor toolbar for quick access to open Kilo from any context

- [#4940](https://github.com/Kilo-Org/kilocode/pull/4940) [`9809864`](https://github.com/Kilo-Org/kilocode/commit/9809864ce51474c29b0db2635a19a92520a2f1f1) Thanks [@Drilmo](https://github.com/Drilmo)! - Add KILOCODE_DEV_CLI_PATH support for easier extension + CLI development workflow

- [#4899](https://github.com/Kilo-Org/kilocode/pull/4899) [`7a58919`](https://github.com/Kilo-Org/kilocode/commit/7a58919c7e4e12e0c954031081e12745419bf8b9) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Disable ask_followup_question tool when yolo mode is enabled to prevent the agent from asking itself questions and auto-answering them. Applied to:

    - XML tool descriptions (system prompt)
    - Native tool filtering
    - Tool execution (returns error message if model still tries to use the tool from conversation history)

- [#4863](https://github.com/Kilo-Org/kilocode/pull/4863) [`c65b798`](https://github.com/Kilo-Org/kilocode/commit/c65b798d99cd07bae2312d284663cd298a1b3f9e) Thanks [@hassoncs](https://github.com/hassoncs)! - Allow users to pick an input device for Speech-to-Text input

- [#4892](https://github.com/Kilo-Org/kilocode/pull/4892) [`b37c944`](https://github.com/Kilo-Org/kilocode/commit/b37c944a8bea644660b6f2c4400d0b47cbdee979) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager session disappearing immediately after starting due to gitUrl race condition

- [#4898](https://github.com/Kilo-Org/kilocode/pull/4898) [`14b22b6`](https://github.com/Kilo-Org/kilocode/commit/14b22b6b9b947ceab6418d6e43962b5535adad1e) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix session becoming non-interactable after clicking "Finish to Branch" button. The session now remains active so users can continue working after committing changes.

- [#4835](https://github.com/Kilo-Org/kilocode/pull/4835) [`d55c093`](https://github.com/Kilo-Org/kilocode/commit/d55c093797c4a816a86ee5ee000f32a98f28199b) Thanks [@lambertjosh](https://github.com/lambertjosh)! - Add section headers to model selection dropdowns for "Recommended models" and "All models"

- [#4891](https://github.com/Kilo-Org/kilocode/pull/4891) [`20f1a16`](https://github.com/Kilo-Org/kilocode/commit/20f1a16e2ed37bd79332bac8ea1358b01c4acbc0) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: prevent double display of MCP marketplace section in settings view

- [#4873](https://github.com/Kilo-Org/kilocode/pull/4873) [`72ed20b`](https://github.com/Kilo-Org/kilocode/commit/72ed20b686f28062fb795beb44377a993bb40a7b) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improve support for VSCode's HTTP proxy settings

- [#4901](https://github.com/Kilo-Org/kilocode/pull/4901) [`140bbf7`](https://github.com/Kilo-Org/kilocode/commit/140bbf7630a81591b18cc60a989690142e6b6039) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Agent Manager: Parallel mode no longer modifies .gitignore

    Worktree exclusion rules are now written to `.git/info/exclude` instead, avoiding changes to tracked files in your repository.

## 4.145.0

### Minor Changes

- [#4955](https://github.com/Kilo-Org/kilocode/pull/4955) [`8789f84`](https://github.com/Kilo-Org/kilocode/commit/8789f84e7d652185fce1767dcc29893080c7da87) Thanks [@iscekic](https://github.com/iscekic)! - add /condense and /compact commands

### Patch Changes

- [#4876](https://github.com/Kilo-Org/kilocode/pull/4876) [`7010f60`](https://github.com/Kilo-Org/kilocode/commit/7010f60bec33b5e1cdeff4a5bc2ad3c638e584cc) Thanks [@markijbema](https://github.com/markijbema)! - Autocomplete: Show entire suggestion when first line has no word characters

- [#4183](https://github.com/Kilo-Org/kilocode/pull/4183) [`de30ffa`](https://github.com/Kilo-Org/kilocode/commit/de30ffa307c2bf0ad72eec67782b67725172f71f) Thanks [@sebastiand-cerebras](https://github.com/sebastiand-cerebras)! - fix(cerebras): use conservative max_tokens and add integration header

    **Conservative max_tokens:**
    Cerebras rate limiter estimates token consumption using max_completion_tokens upfront rather than actual usage. When agentic tools automatically set this to the model maximum (e.g., 64K), users exhaust their quota prematurely and get rate-limited despite minimal actual token consumption.

    This fix uses a conservative default of 8K tokens instead of the model maximum. This is sufficient for most agentic tool use while preserving rate limit headroom.

    **Integration header:**
    Added `X-Cerebras-3rd-Party-Integration: kilocode` header to all Cerebras API requests for tracking and analytics.

- [#4856](https://github.com/Kilo-Org/kilocode/pull/4856) [`100462e`](https://github.com/Kilo-Org/kilocode/commit/100462e956f7f7799525ebddb7d10050435047da) Thanks [@markijbema](https://github.com/markijbema)! - Improve autocomplete tooltip messaging when there's no balance

    When a user has a Kilo Code account with no credits, the autocomplete status bar now shows a helpful message explaining that they need to add credits to use autocomplete, rather than just showing a generic token error.

- [#4793](https://github.com/Kilo-Org/kilocode/pull/4793) [`4fff873`](https://github.com/Kilo-Org/kilocode/commit/4fff873a4b28fa66afbcf837358bcd584665a8be) Thanks [@mcowger](https://github.com/mcowger)! - Restore various providers to modelCache endpoint to fix outdated entries.

## 4.146.0

### Minor Changes

- [#4865](https://github.com/Kilo-Org/kilocode/pull/4865) [`d9e65fe`](https://github.com/Kilo-Org/kilocode/commit/d9e65fe1027943a51cfc1dd97c2eed86ed104748) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.36.7-v3.38.3

    - Feat: Add option in Context settings to recursively load `.kilocode/rules` and `AGENTS.md` from subdirectories (PR #10446 by @mrubens)
    - Fix: Stop frequent Claude Code sign-ins by hardening OAuth refresh token handling (PR #10410 by @hannesrudolph)
    - Fix: Add `maxConcurrentFileReads` limit to native `read_file` tool schema (PR #10449 by @app/roomote)
    - Fix: Add type check for `lastMessage.text` in TTS useEffect to prevent runtime errors (PR #10431 by @app/roomote)
    - Align skills system with Agent Skills specification (PR #10409 by @hannesrudolph)
    - Prevent write_to_file from creating files at truncated paths (PR #10415 by @mrubens and @daniel-lxs)
    - Fix rate limit wait display (PR #10389 by @hannesrudolph)
    - Remove human-relay provider (PR #10388 by @hannesrudolph)
    - Fix: Flush pending tool results before condensing context (PR #10379 by @daniel-lxs)
    - Fix: Revert mergeToolResultText for OpenAI-compatible providers (PR #10381 by @hannesrudolph)
    - Fix: Enforce maxConcurrentFileReads limit in read_file tool (PR #10363 by @roomote)
    - Fix: Improve feedback message when read_file is used on a directory (PR #10371 by @roomote)
    - Fix: Handle custom tool use similarly to MCP tools for IPC schema purposes (PR #10364 by @jr)
    - Add support for npm packages and .env files to custom tools, allowing custom tools to import dependencies and access environment variables (PR #10336 by @cte)
    - Remove simpleReadFileTool feature, streamlining the file reading experience (PR #10254 by @app/roomote)
    - Remove OpenRouter Transforms feature (PR #10341 by @app/roomote)
    - Fix: Send native tool definitions by default for OpenAI to ensure proper tool usage (PR #10314 by @hannesrudolph)
    - Fix: Preserve reasoning_details shape to prevent malformed responses when processing model output (PR #10313 by @hannesrudolph)
    - Fix: Drain queued messages while waiting for ask to prevent message loss (PR #10315 by @hannesrudolph)
    - Feat: Add grace retry for empty assistant messages to improve reliability (PR #10297 by @hannesrudolph)
    - Feat: Enable mergeToolResultText for all OpenAI-compatible providers for better tool result handling (PR #10299 by @hannesrudolph)
    - Feat: Strengthen native tool-use guidance in prompts for improved model behavior (PR #10311 by @hannesrudolph)
    - Add MiniMax M2.1 and improve environment_details handling for Minimax thinking models (PR #10284 by @hannesrudolph)
    - Add GLM-4.7 model with thinking mode support for Zai provider (PR #10282 by @hannesrudolph)
    - Add experimental custom tool calling - define custom tools that integrate seamlessly with your AI workflow (PR #10083 by @cte)
    - Deprecate XML tool protocol selection and force native tool format for new tasks (PR #10281 by @daniel-lxs)
    - Fix: Emit tool_call_end events in OpenAI handler when streaming ends (#10275 by @torxeon, PR #10280 by @daniel-lxs)
    - Fix: Emit tool_call_end events in BaseOpenAiCompatibleProvider (PR #10293 by @hannesrudolph)
    - Fix: Disable strict mode for MCP tools to preserve optional parameters (PR #10220 by @daniel-lxs)
    - Fix: Move array-specific properties into anyOf variant in normalizeToolSchema (PR #10276 by @daniel-lxs)
    - Fix: Add graceful fallback for model parsing in Chutes provider (PR #10279 by @hannesrudolph)
    - Fix: Enable Requesty refresh models with credentials (PR #10273 by @daniel-lxs)
    - Fix: Improve reasoning_details accumulation and serialization (PR #10285 by @hannesrudolph)
    - Fix: Preserve reasoning_content in condense summary for DeepSeek-reasoner (PR #10292 by @hannesrudolph)
    - Refactor Zai provider to merge environment_details into tool result instead of system message (PR #10289 by @hannesrudolph)
    - Remove parallel_tool_calls parameter from litellm provider (PR #10274 by @roomote)
    - Fix: Normalize tool schemas for VS Code LM API to resolve error 400 when using VS Code Language Model API providers (PR #10221 by @hannesrudolph)
    - Add 1M context window beta support for Claude Sonnet 4 on Vertex AI, enabling significantly larger context for complex tasks (PR #10209 by @hannesrudolph)
    - Add native tool call defaults for OpenAI-compatible providers, expanding native function calling across more configurations (PR #10213 by @hannesrudolph)
    - Enable native tool calls for Requesty provider (PR #10211 by @daniel-lxs)
    - Improve API error handling and visibility with clearer error messages and better user feedback (PR #10204 by @brunobergher)
    - Add downloadable error diagnostics from chat errors, making it easier to troubleshoot and report issues (PR #10188 by @brunobergher)
    - Fix refresh models button not properly flushing the cache, ensuring model lists update correctly (#9682 by @tl-hbk, PR #9870 by @pdecat)
    - Fix additionalProperties handling for strict mode compatibility, resolving schema validation issues with certain providers (PR #10210 by @daniel-lxs)
    - Add native tool calling support for Claude models on Vertex AI, enabling more efficient and reliable tool interactions (PR #10197 by @hannesrudolph)
    - Fix JSON Schema format value stripping for OpenAI compatibility, resolving issues with unsupported format values (PR #10198 by @daniel-lxs)
    - Improve "no tools used" error handling with graceful retry mechanism for better reliability when tools fail to execute (PR #10196 by @hannesrudolph)
    - Change default tool protocol from XML to native for improved reliability and performance (PR #10186 by @mrubens)
    - Add native tool support for VS Code Language Model API providers (PR #10191 by @daniel-lxs)
    - Lock task tool protocol for consistent task resumption, ensuring tasks resume with the same protocol they started with (PR #10192 by @daniel-lxs)
    - Replace edit_file tool alias with actual edit_file tool for improved diff editing capabilities (PR #9983 by @hannesrudolph)
    - Fix LiteLLM router models by merging default model info for native tool calling support (PR #10187 by @daniel-lxs)
    - Fix: Add userAgentAppId to Bedrock embedder for code indexing (#10165 by @jackrein, PR #10166 by @roomote)
    - Update OpenAI and Gemini tool preferences for improved model behavior (PR #10170 by @hannesrudolph)
    - Add support for Claude Code Provider native tool calling, improving tool execution performance and reliability (PR #10077 by @hannesrudolph)
    - Enable native tool calling by default for Z.ai models for better model compatibility (PR #10158 by @app/roomote)
    - Enable native tools by default for OpenAI compatible provider to improve tool calling support (PR #10159 by @daniel-lxs)
    - Fix: Normalize MCP tool schemas for Bedrock and OpenAI strict mode to ensure proper tool compatibility (PR #10148 by @daniel-lxs)
    - Fix: Remove dots and colons from MCP tool names for Bedrock compatibility (PR #10152 by @daniel-lxs)
    - Fix: Convert tool_result to XML text when native tools disabled for Bedrock (PR #10155 by @daniel-lxs)
    - Fix: Support AWS GovCloud and China region ARNs in Bedrock provider for expanded regional support (PR #10157 by @app/roomote)
    - Implement interleaved thinking mode for DeepSeek Reasoner, enabling streaming reasoning output (PR #9969 by @hannesrudolph)
    - Fix: Preserve reasoning_content during tool call sequences in DeepSeek (PR #10141 by @hannesrudolph)
    - Fix: Correct token counting for context truncation display (PR #9961 by @hannesrudolph)
    - Fix: Normalize tool call IDs for cross-provider compatibility via OpenRouter, ensuring consistent handling across different AI providers (PR #10102 by @daniel-lxs)
    - Fix: Add additionalProperties: false to nested MCP tool schemas, improving schema validation and preventing unexpected properties (PR #10109 by @daniel-lxs)
    - Fix: Validate tool_result IDs in delegation resume flow, preventing errors when resuming delegated tasks (PR #10135 by @daniel-lxs)
    - Feat: Add full error details to streaming failure dialog, providing more comprehensive information for debugging streaming issues (PR #10131 by @roomote)
    - Implement incremental token-budgeted file reading for smarter, more efficient file content retrieval (PR #10052 by @jr)
    - Enable native tools by default for multiple providers including OpenAI, Azure, Google, Vertex, and more (PR #10059 by @daniel-lxs)
    - Enable native tools by default for Anthropic and add telemetry tracking for tool format usage (PR #10021 by @daniel-lxs)
    - Fix: Prevent race condition from deleting wrong API messages during streaming (PR #10113 by @hannesrudolph)
    - Fix: Prevent duplicate MCP tools error by deduplicating servers at source (PR #10096 by @daniel-lxs)
    - Remove strict ARN validation for Bedrock custom ARN users allowing more flexibility (#10108 by @wisestmumbler, PR #10110 by @roomote)
    - Add metadata to error details dialog for improved debugging (PR #10050 by @roomote)
    - Remove description from Bedrock service tiers for cleaner UI (PR #10118 by @mrubens)
    - Improve tool configuration for OpenAI models in OpenRouter (PR #10082 by @hannesrudolph)
    - Capture more detailed provider-specific error information from OpenRouter for better debugging (PR #10073 by @jr)
    - Add Amazon Nova 2 Lite model to Bedrock provider (#9802 by @Smartsheet-JB-Brown, PR #9830 by @roomote)
    - Add AWS Bedrock service tier support (#9874 by @Smartsheet-JB-Brown, PR #9955 by @roomote)
    - Remove auto-approve toggles for to-do and retry actions to simplify the approval workflow (PR #10062 by @hannesrudolph)
    - Move isToolAllowedForMode out of shared directory for better code organization (PR #10089 by @cte)

### Patch Changes

- [#4950](https://github.com/Kilo-Org/kilocode/pull/4950) [`4b31180`](https://github.com/Kilo-Org/kilocode/commit/4b311806d571e115a6f6ab30d910e0bd39cc317b) Thanks [@markijbema](https://github.com/markijbema)! - Fix chat autocomplete to only show suggestions when textarea has focus, text hasn't changed, and clear suggestions on paste

- [#4995](https://github.com/Kilo-Org/kilocode/pull/4995) [`95e9b6d`](https://github.com/Kilo-Org/kilocode/commit/95e9b6d234681d34f3903715de1ceba67e745516) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - fix: use correct api url for some endpoints

- [#5008](https://github.com/Kilo-Org/kilocode/pull/5008) [`a86cd0c`](https://github.com/Kilo-Org/kilocode/commit/a86cd0c96a0aa0be112ccc5ee957ed3593caf2e8) Thanks [@markijbema](https://github.com/markijbema)! - Minor improvement to markdown autocomplete suggestions

- [#4445](https://github.com/Kilo-Org/kilocode/pull/4445) [`91f9aa3`](https://github.com/Kilo-Org/kilocode/commit/91f9aa34d9f98e85c1500e204b8b576f82c9d606) Thanks [@chriscool](https://github.com/chriscool)! - fix: configure husky hooks for reliable execution

## 4.147.0

### Minor Changes

- [#5023](https://github.com/Kilo-Org/kilocode/pull/5023) [`879bd5d`](https://github.com/Kilo-Org/kilocode/commit/879bd5d6aa8d8e422cf0711ab2729abec10ee511) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Agent Manager now lets you choose which AI model to use when starting a new session. Your model selection is remembered across panel reopens, and active sessions display the model being used.

### Patch Changes

- [#5060](https://github.com/Kilo-Org/kilocode/pull/5060) [`ce99875`](https://github.com/Kilo-Org/kilocode/commit/ce998755310094117d687cc271e117005a46cd90) Thanks [@DoubleDoubleBonus](https://github.com/DoubleDoubleBonus)! - Add OpenAI Native model option gpt-5.2-codex.

- [#4686](https://github.com/Kilo-Org/kilocode/pull/4686) [`2bd899e`](https://github.com/Kilo-Org/kilocode/commit/2bd899eede90bc1e11b32cce55dd52f3e7ac9323) Thanks [@Ashwinhegde19](https://github.com/Ashwinhegde19)! - Fix BrowserSessionRow crash on non-string inputs

- [#4381](https://github.com/Kilo-Org/kilocode/pull/4381) [`e37b839`](https://github.com/Kilo-Org/kilocode/commit/e37b8397bcd1f8bd8742e29b1af8edabc5ddf9db) Thanks [@inj-src](https://github.com/inj-src)! - fix: better chat view by limiting the maximum width

- [#5028](https://github.com/Kilo-Org/kilocode/pull/5028) [`885a54a`](https://github.com/Kilo-Org/kilocode/commit/885a54aae6c43620c431eeb055794f00f2dada0b) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Visual Studio Code's telemetry setting is now respected

- [#4406](https://github.com/Kilo-Org/kilocode/pull/4406) [`7dd14bd`](https://github.com/Kilo-Org/kilocode/commit/7dd14bd35c7aa82bdcbe179a6b1141735778b5a2) Thanks [@Secsys-FDU](https://github.com/Secsys-FDU)! - fix: block Windows CMD injection vectors in auto-approved commands

## 4.148.0

### Minor Changes

- [#4903](https://github.com/Kilo-Org/kilocode/pull/4903) [`db67550`](https://github.com/Kilo-Org/kilocode/commit/db6755024b651ec8401e90935a8185f3c9a145c8) Thanks [@eliasto](https://github.com/eliasto)! - feat(ovhcloud): Add native function calling support

### Patch Changes

- [#5073](https://github.com/Kilo-Org/kilocode/pull/5073) [`ab88311`](https://github.com/Kilo-Org/kilocode/commit/ab883117517b2037e23ab67c68874846be3e5c7c) Thanks [@jrf0110](https://github.com/jrf0110)! - Supports AI Attribution and code formatters format on save. Previously, the AI attribution service would not account for the fact that after saving, the AI generated code would completely change based on the user's configured formatter. This change fixes the issue by using the formatted result for attribution.

- [#5106](https://github.com/Kilo-Org/kilocode/pull/5106) [`a55d1a5`](https://github.com/Kilo-Org/kilocode/commit/a55d1a58a6d127d8649baa95c1a526e119b984fe) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix slow CLI termination when pressing Ctrl+C during prompt selection

    MCP server connection cleanup now uses fire-and-forget pattern for transport.close() and client.close() calls, which could previously block for 2+ seconds if MCP servers were unresponsive. This ensures fast exit behavior when the user wants to quit quickly.

- [#5102](https://github.com/Kilo-Org/kilocode/pull/5102) [`7a528c4`](https://github.com/Kilo-Org/kilocode/commit/7a528c42e1de49336b914ca0cbd58057a16259ad) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Partial reads are now allowed by default, prevent the context to grow too quickly.

- Updated dependencies [[`b2e2630`](https://github.com/Kilo-Org/kilocode/commit/b2e26304e562e516383fbf95a3fdc668d88e1487)]:
    - @kilocode/core-schemas@0.0.1

## 4.148.1

### Patch Changes

- [#5138](https://github.com/Kilo-Org/kilocode/pull/5138) [`e5d08e5`](https://github.com/Kilo-Org/kilocode/commit/e5d08e5464ee85a50cbded2af5a2d0bd3a5390e2) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - fix: prevent duplicate tool_result blocks causing API errors (thanks @daniel-lxs)

- [#5118](https://github.com/Kilo-Org/kilocode/pull/5118) [`9ff3a91`](https://github.com/Kilo-Org/kilocode/commit/9ff3a919ecc9430c8c6c71659cfe1fa734d92877) Thanks [@lambertjosh](https://github.com/lambertjosh)! - Fix model search matching for free tags.

## 4.149.0

### Minor Changes

- [#5176](https://github.com/Kilo-Org/kilocode/pull/5176) [`6765832`](https://github.com/Kilo-Org/kilocode/commit/676583256cb405ef8fb8008f313bfe4a090e9ba0) Thanks [@Drilmo](https://github.com/Drilmo)! - Add image support to Agent Manager

    - Paste images from clipboard (Ctrl/Cmd+V) or select via file browser button
    - Works in new agent prompts, follow-up messages, and resumed sessions
    - Support for PNG, JPEG, WebP, and GIF formats (up to 4 images per message)
    - Click thumbnails to preview, hover to remove
    - New `newTask` stdin message type for initial prompts with images
    - Temp image files are automatically cleaned up when extension deactivates

### Patch Changes

- [#5179](https://github.com/Kilo-Org/kilocode/pull/5179) [`aff6137`](https://github.com/Kilo-Org/kilocode/commit/aff613714afe752fffba01ed5958d6123426b69c) Thanks [@lambertjosh](https://github.com/lambertjosh)! - Fix duplicate tool_result blocks when users approve tool execution with feedback text

    Cherry-picked from upstream Roo-Code:

    - [#10466](https://github.com/RooCodeInc/Roo-Code/pull/10466) - Add explicit deduplication (thanks @daniel-lxs)
    - [#10519](https://github.com/RooCodeInc/Roo-Code/pull/10519) - Merge approval feedback into tool result (thanks @daniel-lxs)

- [#5200](https://github.com/Kilo-Org/kilocode/pull/5200) [`495e5ff`](https://github.com/Kilo-Org/kilocode/commit/495e5ffad395fa49626a2e4992e82c690f0be8c7) Thanks [@catrielmuller](https://github.com/catrielmuller)! - - Fixed webview flickering in JetBrains plugin for smoother UI rendering

    - Improved thread management in JetBrains plugin to prevent UI freezes

- [#5194](https://github.com/Kilo-Org/kilocode/pull/5194) [`fe6c025`](https://github.com/Kilo-Org/kilocode/commit/fe6c02510bd969eb3f7212804bd330beaa9fc4cb) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved the reliability of the read_file tool when using Claude models

- [#5078](https://github.com/Kilo-Org/kilocode/pull/5078) [`d4cc35d`](https://github.com/Kilo-Org/kilocode/commit/d4cc35ddb86ef9d0165e4d61323fa9a0920f2ba7) Thanks [@markijbema](https://github.com/markijbema)! - Remove clipboard reading from chat autocomplete

- Updated dependencies [[`6765832`](https://github.com/Kilo-Org/kilocode/commit/676583256cb405ef8fb8008f313bfe4a090e9ba0), [`cdc3e2e`](https://github.com/Kilo-Org/kilocode/commit/cdc3e2ea32ced833b9d1d1983a4252eda3c0fdf1)]:
    - @kilocode/core-schemas@0.0.2

## 4.150.0

### Minor Changes

- [#5239](https://github.com/Kilo-Org/kilocode/pull/5239) [`ff1500d`](https://github.com/Kilo-Org/kilocode/commit/ff1500d75f4cefee6b7fd7fd1e126339b147255d) Thanks [@markijbema](https://github.com/markijbema)! - Added Skills Marketplace tab alongside existing MCP and Modes marketplace tabs

### Patch Changes

- [#5193](https://github.com/Kilo-Org/kilocode/pull/5193) [`ff3cbe5`](https://github.com/Kilo-Org/kilocode/commit/ff3cbe521bbcccfc18a7b37cd69a190c0291badb) Thanks [@mayef](https://github.com/mayef)! - Fix Cerebras provider to ensure all tools have consistent strict mode values

- [#5208](https://github.com/Kilo-Org/kilocode/pull/5208) [`f770cec`](https://github.com/Kilo-Org/kilocode/commit/f770cecf01d037ed9da31114603940f2a66a145a) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix terminal button showing "Session not found" for remote sessions in Agent Manager

- [#5213](https://github.com/Kilo-Org/kilocode/pull/5213) [`553fc58`](https://github.com/Kilo-Org/kilocode/commit/553fc58293a73b62793ca9e05921bf6e413e0c85) Thanks [@jrf0110](https://github.com/jrf0110)! - Add AI Attribution line tracking to the EditFileTool

- [#5240](https://github.com/Kilo-Org/kilocode/pull/5240) [`6d297fb`](https://github.com/Kilo-Org/kilocode/commit/6d297fb8fe1d33aa58b941a0bb903c1847996407) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Fix Autocomplete

- [#5044](https://github.com/Kilo-Org/kilocode/pull/5044) [`2ee6e82`](https://github.com/Kilo-Org/kilocode/commit/2ee6e822b6d7fabb2d136dd03117c469b00ee51d) Thanks [@jrf0110](https://github.com/jrf0110)! - Add GitHub-style diff stats display to task header showing lines added/removed in real-time

- [#5228](https://github.com/Kilo-Org/kilocode/pull/5228) [`b834a25`](https://github.com/Kilo-Org/kilocode/commit/b834a25ea075fac7b95762e2355cf04d05d2633e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fallbacks are now allowed when selecting a specific OpenRouter provider