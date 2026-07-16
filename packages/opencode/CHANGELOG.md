# @kilocode/cli

## 7.4.9

### Patch Changes

- [#12244](https://github.com/Kilo-Org/kilocode/pull/12244) [`fe41426`](https://github.com/Kilo-Org/kilocode/commit/fe4142630c7dddf19e81b2f3363e06b4aba8194a) - Fix Agent Manager tool calls through providers that require object-root input schemas without root combinators.

- [#12243](https://github.com/Kilo-Org/kilocode/pull/12243) [`e4ceeae`](https://github.com/Kilo-Org/kilocode/commit/e4ceeaebb911a7350b9aaa7851aa39293c0892f8) - Prevent stalled operating system process queries from blocking background process management.

## 7.4.8

### Minor Changes

- [#12159](https://github.com/Kilo-Org/kilocode/pull/12159) [`1083bb8`](https://github.com/Kilo-Org/kilocode/commit/1083bb82b65e986dfbc7092647b6ee2650951265) - Report active CLI and VS Code app and session presence.

### Patch Changes

- [#12160](https://github.com/Kilo-Org/kilocode/pull/12160) [`ba6e5b9`](https://github.com/Kilo-Org/kilocode/commit/ba6e5b9dfcddb6b5752e1c06951098213a2ceabe) - Allow persistent approval for shell access to a specific global skill directory while keeping other Kilo configuration protected.

- [#12097](https://github.com/Kilo-Org/kilocode/pull/12097) [`22d6edb`](https://github.com/Kilo-Org/kilocode/commit/22d6edbe59a82f87362e8a49e739f8d4a4802f90) - Release project file handles immediately after reads on Windows so editors and tools can replace existing files without restarting Kilo.

- [#12175](https://github.com/Kilo-Org/kilocode/pull/12175) [`bd08c13`](https://github.com/Kilo-Org/kilocode/commit/bd08c1341289c5d30facad6bcfed4b02cd33262d) - Preserve the selected model reasoning variant when forking a session.

- [#12128](https://github.com/Kilo-Org/kilocode/pull/12128) [`ad2cc71`](https://github.com/Kilo-Org/kilocode/commit/ad2cc712d084e2540d4846f561b2cfe39ee9ee15) Thanks [@rakshith1928](https://github.com/rakshith1928)! - Surface an invalid Kilo `indexing.model` configuration as an indexing Error status instead of silently falling back to the default model.

- [#11783](https://github.com/Kilo-Org/kilocode/pull/11783) [`6a3e5f3`](https://github.com/Kilo-Org/kilocode/commit/6a3e5f39011e4b1a63ab5d0ae0dbf8195ea29d4c) - Inherit sandbox state when a sandboxed agent starts new Agent Manager sessions.

- [#12203](https://github.com/Kilo-Org/kilocode/pull/12203) [`750b622`](https://github.com/Kilo-Org/kilocode/commit/750b622f487b17d5b5344cace403e80fa3374935) - Keep Agent Manager sessions running when concurrent branch-name generation times out during model refresh.

- [#12174](https://github.com/Kilo-Org/kilocode/pull/12174) [`3ba4c33`](https://github.com/Kilo-Org/kilocode/commit/3ba4c33544451076bd5ecb3b698e74ede0434c82) - Inspect managed Agent Manager sessions and send a targeted prompt to an idle existing session from the native Agent Manager tool. Require a separate explicit approval before prompting another managed session.

- [#12156](https://github.com/Kilo-Org/kilocode/pull/12156) [`6f11e35`](https://github.com/Kilo-Org/kilocode/commit/6f11e3576488e06e99337c81abb29f5e8aa8908c) - Preserve gateway and provider errors when chunked compaction fails instead of reporting every failure as a context overflow.

- [#12205](https://github.com/Kilo-Org/kilocode/pull/12205) [`2045190`](https://github.com/Kilo-Org/kilocode/commit/204519025ae5f00abe41afdec4c935113002874c) - Temporarily disable free-model session and Git workspace data export.

- [#12158](https://github.com/Kilo-Org/kilocode/pull/12158) [`3b1e07c`](https://github.com/Kilo-Org/kilocode/commit/3b1e07cc0033bdb37e762ed6e0f85dab4214780d) - Enforce read and ignore permissions when file mentions add content to a prompt.

- [#12207](https://github.com/Kilo-Org/kilocode/pull/12207) [`c49560a`](https://github.com/Kilo-Org/kilocode/commit/c49560af0f94459015d3fa4e1efa23ad9b291955) - Keep shared session databases writable by released Kilo clients after newer schema migrations run.

- [#11424](https://github.com/Kilo-Org/kilocode/pull/11424) [`3a4438e`](https://github.com/Kilo-Org/kilocode/commit/3a4438e748f80a23bd33eb4aa824d3dffb3d588a) - Stop active Agent Manager sessions and their subagents when a session tab or the Agent Manager tab closes.

- Updated dependencies [[`6a3e5f3`](https://github.com/Kilo-Org/kilocode/commit/6a3e5f39011e4b1a63ab5d0ae0dbf8195ea29d4c), [`227c65d`](https://github.com/Kilo-Org/kilocode/commit/227c65d1004fc1f48e71335cc574a2e6986c4893), [`3ba4c33`](https://github.com/Kilo-Org/kilocode/commit/3ba4c33544451076bd5ecb3b698e74ede0434c82)]:
  - @kilocode/sdk@7.4.8
  - @kilocode/kilo-indexing@7.4.8
  - @kilocode/plugin@7.4.8
  - @opencode-ai/ui@7.4.8
  - @kilocode/kilo-gateway@7.4.8
  - @kilocode/plugin-atomic-chat@7.4.8
  - @opencode-ai/server@7.4.2
  - @kilocode/kilo-telemetry@7.4.8

## 7.4.7

## 7.4.6

### Minor Changes

- [#12075](https://github.com/Kilo-Org/kilocode/pull/12075) [`1e0b25a`](https://github.com/Kilo-Org/kilocode/commit/1e0b25a134a11c03494d5871be3e43a6881f1d87) - Support configuring network destinations that sandboxed tools can reach while network access is otherwise restricted.

### Patch Changes

- [#12073](https://github.com/Kilo-Org/kilocode/pull/12073) [`71aa54e`](https://github.com/Kilo-Org/kilocode/commit/71aa54e4131a9ac9b39d2d9585b2101da76d35ca) - Inherit the current model and reasoning variant when Agent Manager starts sessions without explicit overrides.

- [#12166](https://github.com/Kilo-Org/kilocode/pull/12166) [`4618f1b`](https://github.com/Kilo-Org/kilocode/commit/4618f1b092a948459374a733625f06d02447dc6e) - Preserve dynamic tool properties when removing unsupported regex lookarounds.

- [#12164](https://github.com/Kilo-Org/kilocode/pull/12164) [`039b73d`](https://github.com/Kilo-Org/kilocode/commit/039b73dfaefe93452501a48914eaeeb2f83c572b) - Wait for the primary codebase index before indexing a linked worktree, preventing large worktrees from consuming excessive CPU during startup.

- [#12106](https://github.com/Kilo-Org/kilocode/pull/12106) [`b6b55d1`](https://github.com/Kilo-Org/kilocode/commit/b6b55d1a3454bc057ddd24144b0f8d21f870ee55) - Make session model usage easier to scan with collapsible summary rows and aligned steps and cost columns.

- [#12093](https://github.com/Kilo-Org/kilocode/pull/12093) [`8b46601`](https://github.com/Kilo-Org/kilocode/commit/8b466010c58497acd35867c8a67292c063f3dac4) - Speed up VS Code settings saves by draining pending prompts and disposing worktree instances concurrently.

- [#12079](https://github.com/Kilo-Org/kilocode/pull/12079) [`0a64070`](https://github.com/Kilo-Org/kilocode/commit/0a640706adcf15968ebc5436e83c6a9c5b8cc4ad) - Resolve AWS Bedrock credentials from SSO profiles in packaged CLI builds.

- [#12101](https://github.com/Kilo-Org/kilocode/pull/12101) [`bf2b33b`](https://github.com/Kilo-Org/kilocode/commit/bf2b33b87bfc5c35de2173ea66c50e630458e2a5) Thanks [@Githubguy132010](https://github.com/Githubguy132010)! - Use the correct `filePath` argument name in the Gemini system prompt.

- [#12149](https://github.com/Kilo-Org/kilocode/pull/12149) [`05dadaa`](https://github.com/Kilo-Org/kilocode/commit/05dadaaaed29a04c93aa25f85bddea73a155139e) Thanks [@umi008](https://github.com/umi008)! - Fix Gemma 4 models failing with "thinkingLevel not supported" when using Google AI Studio.

- [#12148](https://github.com/Kilo-Org/kilocode/pull/12148) [`77f7983`](https://github.com/Kilo-Org/kilocode/commit/77f7983995bcf52debe03ed9209dc56ba3153c31) Thanks [@umi008](https://github.com/umi008)! - Install the latest stable CLI release when newer non-CLI or prerelease releases exist.

- [#12167](https://github.com/Kilo-Org/kilocode/pull/12167) [`988a92e`](https://github.com/Kilo-Org/kilocode/commit/988a92eae99e453f5a4fe260b0894d93b7271de9) - Fix `kilo upgrade` for curl installs resolving the wrong latest version

  The upgrade command's version resolution for curl-detected installations used GitHub's `/releases/latest` endpoint, which now returns JetBrains plugin releases (e.g. `jetbrains/v7.0.4`) instead of the latest CLI release. This caused `kilo upgrade` to fail for curl installs. Version resolution now uses the npm `latest` dist-tag, matching the install script fix.

- [#11837](https://github.com/Kilo-Org/kilocode/pull/11837) [`654e10e`](https://github.com/Kilo-Org/kilocode/commit/654e10e25b320fc4518dec192e3fb63137b47182) Thanks [@mjnaderi](https://github.com/mjnaderi)! - Show the Kilo Gateway rate-limit message when login has too many pending authorization requests.

- [#12162](https://github.com/Kilo-Org/kilocode/pull/12162) [`3ee9144`](https://github.com/Kilo-Org/kilocode/commit/3ee91448eeadf353fc611d8e42ac1f5c8cb5eac0) - Show troubleshooting and migration guidance when Google Gemini rejects API credentials.

- [#11955](https://github.com/Kilo-Org/kilocode/pull/11955) [`cac82a3`](https://github.com/Kilo-Org/kilocode/commit/cac82a36cac448154c880a0ebdfd283b89559668) Thanks [@jstar0](https://github.com/jstar0)! - Prevent Gemini requests from failing when MCP tool schemas contain `required` fields without matching object properties.

- [#12153](https://github.com/Kilo-Org/kilocode/pull/12153) [`be15cf4`](https://github.com/Kilo-Org/kilocode/commit/be15cf4b556bea96aaef6de1b3c405b86c0d1a6c) - Allow GPT-5.6 models to use tools whose JSON schemas contain regex lookarounds.

- [#12168](https://github.com/Kilo-Org/kilocode/pull/12168) [`032f3bb`](https://github.com/Kilo-Org/kilocode/commit/032f3bb55f85ce2b2cc07cea54edf59b23abfcc4) - Block environment and out-of-project file substitutions in project markdown configuration.

- [#12040](https://github.com/Kilo-Org/kilocode/pull/12040) [`93c209b`](https://github.com/Kilo-Org/kilocode/commit/93c209bfd1f068b26b38ac4e9b7237d4c7f095e1) Thanks [@rakshith1928](https://github.com/rakshith1928)! - Hide gpt-5.5-pro from the model picker when using ChatGPT OAuth login, since Codex rejects it with HTTP 400.

- [#12087](https://github.com/Kilo-Org/kilocode/pull/12087) [`1f99fb2`](https://github.com/Kilo-Org/kilocode/commit/1f99fb2332b398f8f5066587c970454e7c9d49f9) - Stop explicitly directing GPT and Codex models to delegate tasks to subagents.

- [#12105](https://github.com/Kilo-Org/kilocode/pull/12105) [`e0bfed3`](https://github.com/Kilo-Org/kilocode/commit/e0bfed308ce7906e4d9ca923e82eda1c20cefd2b) - Shut down the headless `kilo serve` process automatically when the editor client that launched it exits without a clean signal, preventing orphaned CLI processes.

- [#12092](https://github.com/Kilo-Org/kilocode/pull/12092) [`94b553b`](https://github.com/Kilo-Org/kilocode/commit/94b553b91b130d996ce833e168e579df51a14957) - Show detailed GPT-5.6 reasoning summaries and avoid expandable blank panels when a provider returns only a summary title.

- Updated dependencies [[`039b73d`](https://github.com/Kilo-Org/kilocode/commit/039b73dfaefe93452501a48914eaeeb2f83c572b), [`1e0b25a`](https://github.com/Kilo-Org/kilocode/commit/1e0b25a134a11c03494d5871be3e43a6881f1d87)]:
  - @kilocode/kilo-indexing@7.4.6
  - @kilocode/sdk@7.5.0
  - @kilocode/plugin@7.4.6
  - @opencode-ai/ui@7.4.6
  - @kilocode/kilo-gateway@7.4.6
  - @kilocode/plugin-atomic-chat@7.4.6
  - @kilocode/kilo-telemetry@7.4.6

## 7.4.4

### Minor Changes

- [#12049](https://github.com/Kilo-Org/kilocode/pull/12049) [`394af39`](https://github.com/Kilo-Org/kilocode/commit/394af39c64b2920fa8c84f14670f213820cef2ec) - Configure sandboxing through first-class sandbox settings, and show its controls in the dedicated Sandboxing page for all supported macOS and Linux users while keeping it disabled by default.

### Patch Changes

- Updated dependencies [[`394af39`](https://github.com/Kilo-Org/kilocode/commit/394af39c64b2920fa8c84f14670f213820cef2ec)]:
  - @kilocode/sdk@7.5.0
  - @kilocode/plugin@7.4.4
  - @opencode-ai/ui@7.4.4
  - @kilocode/kilo-gateway@7.4.4
  - @kilocode/kilo-indexing@7.4.4
  - @kilocode/plugin-atomic-chat@7.4.4
  - @kilocode/kilo-telemetry@7.4.4

## 7.4.3

### Minor Changes

- [#12067](https://github.com/Kilo-Org/kilocode/pull/12067) [`ed36326`](https://github.com/Kilo-Org/kilocode/commit/ed36326b1f4b3ced02e24b07e54ec665d8ce5cc4) - Support task-aware pruning of agent-invoked Bash output with experimental SWE-Pruner.

### Patch Changes

- [#12052](https://github.com/Kilo-Org/kilocode/pull/12052) [`61d90f1`](https://github.com/Kilo-Org/kilocode/commit/61d90f166ab2e8230c87f5cc5d0e8d932d720911) - Exclude directory-scoped AGENTS.md instructions from SWE-Pruner context.

## 7.4.2

### Minor Changes

- [#11921](https://github.com/Kilo-Org/kilocode/pull/11921) [`b976b5a`](https://github.com/Kilo-Org/kilocode/commit/b976b5a0137b6fa6c7959d5c8a548478efee1d1e) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Add opt-in project memory commands, tools, automatic capture, and public API support.

- [#12004](https://github.com/Kilo-Org/kilocode/pull/12004) [`cef3dc7`](https://github.com/Kilo-Org/kilocode/commit/cef3dc7ae8a7ef7f26e36fb690af5014b542b7bb) - Add a reload action that reboots the per-directory instance, picking up config, skills, agents, commands, and MCP prompts changed on disk. Sessions and history are preserved. Surfaces: `/reload` in the CLI palette and editor chat, a reload button in the task header and settings panel, the `Kilo Code: Reload Config and Skills` command, and a `POST /instance/reload` HTTP endpoint. The endpoint returns 409 while a session is actively running.

- [#11835](https://github.com/Kilo-Org/kilocode/pull/11835) [`cd49ae6`](https://github.com/Kilo-Org/kilocode/commit/cd49ae633cab8b6887f6b37abc4ef1e6475a852e) - Support provider-aware model discovery and selection for remote Cloud sessions.

- [#11980](https://github.com/Kilo-Org/kilocode/pull/11980) [`adcbe0f`](https://github.com/Kilo-Org/kilocode/commit/adcbe0f37321704abdc0994d4e1f78919c9bfa5a) Thanks [@Drilmo](https://github.com/Drilmo)! - Add experimental SWE-Pruner support (disabled by default). When enabled via `experimental.swe_pruner` or the Experimental settings tab in VS Code, the read and grep tools accept an optional `context_focus_question` parameter; when the agent provides it, large tool outputs are pruned by a small model down to the lines relevant to that question, with omitted sections marked inline and a `SWE-Pruner · kept/total` indicator on the tool row. The skimming model can be overridden via `experimental.swe_pruner_model` (defaults to the configured small model). Any pruning failure falls back to the full output.

- [#11428](https://github.com/Kilo-Org/kilocode/pull/11428) [`69f5b9d`](https://github.com/Kilo-Org/kilocode/commit/69f5b9d66df88f727a80c8f4fdb3f2ccc7162f35) Thanks [@drye](https://github.com/drye)! - Add vim modal editing to the CLI prompt input. Enable it with `"vim": true` in `tui.jsonc`, the `Toggle vim mode` command in the command palette, or the `/vim` slash command. Supports NORMAL-mode motions (h/j/k/l, w/b/e, 0/^/$, gg/G, counts), edits (x, dd, dw, cw, D, C, r, yy/p, u, Ctrl+r), insert transitions (i/a/A/I/o/O), and VISUAL / VISUAL-LINE mode (v/V with selection-extending motions, d/x/c/s/y, o to swap ends), with a mode indicator and matching cursor shape.

### Patch Changes

- [#11223](https://github.com/Kilo-Org/kilocode/pull/11223) [`4104ab5`](https://github.com/Kilo-Org/kilocode/commit/4104ab59d9cc4bcf4643afbe1f71174d754c4e0e) Thanks [@maphew](https://github.com/maphew)! - Fix cloud session fork commands so they import cloud sessions before validating the local session.

- [#12033](https://github.com/Kilo-Org/kilocode/pull/12033) [`9fc1a1d`](https://github.com/Kilo-Org/kilocode/commit/9fc1a1d94c29236ce0d949e9a6b2fefc70afaab8) - Show a clear "No changes found to generate a commit message for" error instead of a generic "Unexpected server error" when there is nothing to commit. The endpoint now returns a typed 422, and the extension surfaces the real message directly.

- [#11886](https://github.com/Kilo-Org/kilocode/pull/11886) [`b793bf7`](https://github.com/Kilo-Org/kilocode/commit/b793bf788f20e5d96898c0565916af7bc71a5683) - Harden config credential substitution against untrusted project config. Environment references (`{env:VAR}`) now resolve only in trusted config (global config, `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, and org/MDM-managed config); a project-committed `kilo.json` / `opencode.json` can no longer use them. File references (`{file:...}`) still work in project config but are confined to the project root, so absolute paths, `../` traversal, and symlink escapes are rejected. This closes a path where a malicious repository could exfiltrate local secrets to an attacker-controlled `baseURL`.

- [#12002](https://github.com/Kilo-Org/kilocode/pull/12002) [`885a994`](https://github.com/Kilo-Org/kilocode/commit/885a994106741ea7caf59c051812cd7521f4cf2c) - Defer Agent Manager automatic branch naming until the conversation shows a durable task. The first user message no longer renames the branch; naming waits for a second message (up to four) or for the worktree to contain changes, and renames only run while the session is idle. Read-only verification questions (for example "is X fixed?") no longer claim the branch name.

- [#11968](https://github.com/Kilo-Org/kilocode/pull/11968) [`7571508`](https://github.com/Kilo-Org/kilocode/commit/75715088b11e932b331dbc3580c7744d3ae2d494) - Fix Amazon Bedrock models returning no output. A smithy dependency version-skew made the Bedrock event-stream decoder silently fail under the browser build condition, so every Bedrock request completed with an empty response.

- [#12042](https://github.com/Kilo-Org/kilocode/pull/12042) [`22b9f7f`](https://github.com/Kilo-Org/kilocode/commit/22b9f7fd932043722096919aabb08109901f01de) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Respect nested `.gitignore` and `.kilocodeignore` files during codebase indexing.

- [#11976](https://github.com/Kilo-Org/kilocode/pull/11976) [`40790d8`](https://github.com/Kilo-Org/kilocode/commit/40790d8139ea3a87b0b1ccf51339e2effb16ae67) - Show the Remote badge in the TUI prompt status area when remote session relay is enabled.

- [#11999](https://github.com/Kilo-Org/kilocode/pull/11999) [`61b9e09`](https://github.com/Kilo-Org/kilocode/commit/61b9e0935cb3314acdabb4d3237b95395bfffb06) - Use cloud account preferences to select the active Kilo organization and hide unavailable personal accounts.

- [#11994](https://github.com/Kilo-Org/kilocode/pull/11994) [`eefd891`](https://github.com/Kilo-Org/kilocode/commit/eefd891c62fb064275a4ec815c320422ca7e70ac) Thanks [@IOLOII](https://github.com/IOLOII)! - Generate commit messages in the user's selected UI language instead of always using English.

- [#11506](https://github.com/Kilo-Org/kilocode/pull/11506) [`5135d2e`](https://github.com/Kilo-Org/kilocode/commit/5135d2e2434c075ccdc5c688dd01aec2a087ec7c) Thanks [@mvanhorn](https://github.com/mvanhorn)! - Show live session spend in the TUI sidebar while an assistant turn is still running.

- [#12034](https://github.com/Kilo-Org/kilocode/pull/12034) [`64c9b7e`](https://github.com/Kilo-Org/kilocode/commit/64c9b7e42ff329d31998ea0f7cb01df6a981dcf3) - Show a dismissible notification when a leftover opencode config directory is found. Kilo no longer falls back to opencode configuration, so the notice points you to move `.opencode` config into a `.kilo` directory (or the global kilo config dir). Dismiss it once and it won't return unless the directory is still present.

- Updated dependencies [[`b976b5a`](https://github.com/Kilo-Org/kilocode/commit/b976b5a0137b6fa6c7959d5c8a548478efee1d1e), [`22b9f7f`](https://github.com/Kilo-Org/kilocode/commit/22b9f7fd932043722096919aabb08109901f01de), [`61b9e09`](https://github.com/Kilo-Org/kilocode/commit/61b9e0935cb3314acdabb4d3237b95395bfffb06), [`adcbe0f`](https://github.com/Kilo-Org/kilocode/commit/adcbe0f37321704abdc0994d4e1f78919c9bfa5a)]:
  - @kilocode/sdk@7.5.0
  - @kilocode/kilo-memory@7.5.0
  - @kilocode/kilo-indexing@7.4.2
  - @kilocode/kilo-gateway@7.4.2
  - @kilocode/plugin@7.4.2
  - @opencode-ai/ui@7.4.2
  - @kilocode/kilo-telemetry@7.4.2
  - @kilocode/plugin-atomic-chat@7.4.2

## 7.4.1

### Patch Changes

- [#11887](https://github.com/Kilo-Org/kilocode/pull/11887) [`51dc189`](https://github.com/Kilo-Org/kilocode/commit/51dc189682107615d6af3fc6306d64fa3d5dafd8) - Require authentication before enabling allow-everything permissions over HTTP.

- [#11923](https://github.com/Kilo-Org/kilocode/pull/11923) [`fda4e17`](https://github.com/Kilo-Org/kilocode/commit/fda4e1756b3de46da3ac2081d440969a32ae5a59) - Fail subagent permission prompts in headless `kilo run` immediately instead of hanging forever, and approve subagent permission prompts under `--dangerously-skip-permissions`

## 7.4.0

### Minor Changes

- [#11912](https://github.com/Kilo-Org/kilocode/pull/11912) [`1f80fdf`](https://github.com/Kilo-Org/kilocode/commit/1f80fdff4e66985b8c590e1ce6d8da3720fd035d) - Persist the `/sandbox` toggle across new CLI sessions per project directory, mirroring the VS Code extension's sandbox button. New sessions now inherit the last toggled state instead of resetting to the config default each time.

### Patch Changes

- [#11906](https://github.com/Kilo-Org/kilocode/pull/11906) [`1d3a9e0`](https://github.com/Kilo-Org/kilocode/commit/1d3a9e032d62182784d4efdab2a2665c3747125d) - Support adaptive reasoning presets for Claude Fable and Sonnet 5 models.

- [#11084](https://github.com/Kilo-Org/kilocode/pull/11084) [`69e5c58`](https://github.com/Kilo-Org/kilocode/commit/69e5c58eb6874b8a1329d61821dc25a60a3495cd) Thanks [@maphew](https://github.com/maphew)! - Use `/review` as the single local review command, defaulting to staged, unstaged, and untracked changes while supporting guided uncommitted reviews, branch/base reviews, commits, and pull requests. Show deprecation notices for `/local-review` and `/local-review-uncommitted` that point to the matching `/review` modes.

- [#11896](https://github.com/Kilo-Org/kilocode/pull/11896) [`c36c293`](https://github.com/Kilo-Org/kilocode/commit/c36c293f3c9a7d6d67e392cdf3f57c3a4955b993) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Report the plan file that was actually saved in Plan mode: point the "Plan is ready" link, the follow-up prompt, and the new-session handoff at the real file instead of a wrongly generated name, and fail plan_exit with a clear error when no plan was written.

- [#11808](https://github.com/Kilo-Org/kilocode/pull/11808) [`ce09eb3`](https://github.com/Kilo-Org/kilocode/commit/ce09eb39b5c7199e941a4df3229ab5ad2a3af230) - Show an interactive Implement / Keep refining panel when Plan mode is ready instead of asking users to type a numbered choice.

- [#11891](https://github.com/Kilo-Org/kilocode/pull/11891) [`9857c98`](https://github.com/Kilo-Org/kilocode/commit/9857c9861e16f583971fc29c98962bfb278419f2) - Preserve model output capacity when requests contain encoded images. The output token cap now uses the provider-reported context size from the previous turn, so image and vision input is measured by the provider instead of by encoded payload size.

- [#11838](https://github.com/Kilo-Org/kilocode/pull/11838) [`eec075b`](https://github.com/Kilo-Org/kilocode/commit/eec075bc86a0f67b17f778908bd4c2d796024cda) - Retain the sandbox toggle state when forking a session or moving it to a worktree, instead of resetting it to the workspace default.

- [#11898](https://github.com/Kilo-Org/kilocode/pull/11898) [`067fcf5`](https://github.com/Kilo-Org/kilocode/commit/067fcf51f87bdb1b229d0c93b08a63f79c6b1eb7) - Keep sandboxing disabled by default unless the experimental sandbox setting or an explicit session toggle enables it.

- [#11913](https://github.com/Kilo-Org/kilocode/pull/11913) [`70a002d`](https://github.com/Kilo-Org/kilocode/commit/70a002da470af3cee9fd2aeffc7d39af930770d9) - Fix shell tool occasionally returning "(no output)" for fast-exiting commands

- [#11496](https://github.com/Kilo-Org/kilocode/pull/11496) [`bc0236b`](https://github.com/Kilo-Org/kilocode/commit/bc0236bbfbed8228e49049a6644acd04410fdf09) - Show the usable local IPv6 URL when the server binds to the IPv6 wildcard address.

- [#11833](https://github.com/Kilo-Org/kilocode/pull/11833) [`8cdd0aa`](https://github.com/Kilo-Org/kilocode/commit/8cdd0aab15dd9c7b5aa9f7a5e17db35d052b5b69) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Add `/cost-alert` to get notified when a session's cost crosses a threshold you set.

- [#11553](https://github.com/Kilo-Org/kilocode/pull/11553) [`3847122`](https://github.com/Kilo-Org/kilocode/commit/3847122555cf9d8ec723ec9d62753b0e9c72ccbc) - Improve JetBrains agent, MCP, provider, and model settings so changes are staged until Apply, persist through the CLI, reload accurately, and hide unsupported removal actions.

- [#11767](https://github.com/Kilo-Org/kilocode/pull/11767) [`c94a097`](https://github.com/Kilo-Org/kilocode/commit/c94a097758b76ff5890a8a85ddb647f1e0879375) - Fix non-default agents (Ask, Plan, and custom or organization agents) failing with a "Bad Request: Unsupported parameter(s)" error on some models and providers.

- [#11701](https://github.com/Kilo-Org/kilocode/pull/11701) [`61bc5d6`](https://github.com/Kilo-Org/kilocode/commit/61bc5d688af4783b7059d8da9f5e574fda2af5a0) - Use model family metadata when selecting the apply_patch tool for GPT models.

## 7.3.63

### Minor Changes

- [#11714](https://github.com/Kilo-Org/kilocode/pull/11714) [`7b2063f`](https://github.com/Kilo-Org/kilocode/commit/7b2063f35440fd65e9ec2d38fd656da960ff48b6) - Connect to a local Anaconda Desktop text-generation model server from the CLI or VS Code.

- [#11786](https://github.com/Kilo-Org/kilocode/pull/11786) [`123a939`](https://github.com/Kilo-Org/kilocode/commit/123a9395d2ec645c3dc247170188f42bbf7c9333) - Allow Agent Manager chat tools to discover available models and reasoning variants by model name, then start each session with the chosen model and reasoning effort. Agent Manager resolves the provider for a named model automatically, preferring the provider behind the current default model and falling back to the Kilo Gateway.

- [#11456](https://github.com/Kilo-Org/kilocode/pull/11456) [`afa9633`](https://github.com/Kilo-Org/kilocode/commit/afa963375e17188b736c8b246f32e13f46401480) - Allow background processes to transfer from subagents to parent sessions, or remain accessible from every session in their project after Kilo restarts.

- [#11394](https://github.com/Kilo-Org/kilocode/pull/11394) [`bbf3c5b`](https://github.com/Kilo-Org/kilocode/commit/bbf3c5b43d58d47f5a9270ee26fb51a2f97b7fcc) - Run commands that require human interaction in an embedded CLI terminal dialog and return their output to the model when complete.

- [#11729](https://github.com/Kilo-Org/kilocode/pull/11729) [`7d64eb7`](https://github.com/Kilo-Org/kilocode/commit/7d64eb74f9017b6726830eb0df0b9e6d4e5885ef) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Show personal credits, team credits, and Kilo Pass in the CLI sidebar, and refresh the balance immediately after switching teams.

- [#11659](https://github.com/Kilo-Org/kilocode/pull/11659) [`7f4702b`](https://github.com/Kilo-Org/kilocode/commit/7f4702bec9028206b9479e0add9725e13b09b86c) - Enforce the sandbox network restriction for agent commands on Linux, including TCP, UDP, IPv4, IPv6, and descendant processes.

- [#11603](https://github.com/Kilo-Org/kilocode/pull/11603) [`9fbc456`](https://github.com/Kilo-Org/kilocode/commit/9fbc456b75887ee314c339bc1eba7decba79c6c0) - Block outbound network access from agent commands and in-process HTTP tools with the optional macOS sandbox, with a Sandboxing setting to allow network access when needed.

- [#11548](https://github.com/Kilo-Org/kilocode/pull/11548) [`c55e804`](https://github.com/Kilo-Org/kilocode/commit/c55e804c1cf7b0a0d9f7693e19daeeb91c4c8624) - Confine agent shell and file-tool writes to project and Kilo state directories with the optional macOS and Linux sandboxes.

- [#11628](https://github.com/Kilo-Org/kilocode/pull/11628) [`2638e06`](https://github.com/Kilo-Org/kilocode/commit/2638e06ffbeff598672b671837380ef282f9f34c) - Add session-local macOS sandbox controls, show the effective active state, and confirm toggles in the CLI and VS Code extension.

### Patch Changes

- [#11762](https://github.com/Kilo-Org/kilocode/pull/11762) [`d89b1b6`](https://github.com/Kilo-Org/kilocode/commit/d89b1b6e16fb935c785f731faa37bdd79556ee7a) - Gate experimental agents on their declared skill, MCP, and VS Code extension requirements. VS Code shows requirement groups with Marketplace shortcuts, and the CLI stops before sending when requirements are unmet.

- [#11594](https://github.com/Kilo-Org/kilocode/pull/11594) [`f69d1cd`](https://github.com/Kilo-Org/kilocode/commit/f69d1cd4be6ba4c7578ca95d7e4602e11d8c56ac) - Keep turns responsive when snapshot infrastructure stalls and prevent transient snapshot progress from appearing in forked sessions.

- [#11526](https://github.com/Kilo-Org/kilocode/pull/11526) [`579a787`](https://github.com/Kilo-Org/kilocode/commit/579a787047632ad15fc1ca90aabd7e1d1edd5a7c) - Run Windows PowerShell tool commands without `-EncodedCommand` to reduce antivirus false positives.

- [#11505](https://github.com/Kilo-Org/kilocode/pull/11505) [`55203c3`](https://github.com/Kilo-Org/kilocode/commit/55203c3a2c2110aac874069e46a4d96e1a5e2958) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Create the default `.kilo/plans` directory automatically when Plan mode starts.

- [#11601](https://github.com/Kilo-Org/kilocode/pull/11601) [`2404009`](https://github.com/Kilo-Org/kilocode/commit/2404009bc005ef4971580f1da859147aa60be265) - Fix `kilo upgrade` for curl installs by pointing at the install script instead of the install landing page.

- [#11798](https://github.com/Kilo-Org/kilocode/pull/11798) [`1d798a1`](https://github.com/Kilo-Org/kilocode/commit/1d798a106f315dc3c1c4c78382eff7a6bd23343b) - Fix opening KiloClaw from the CLI and VS Code slash commands.

- [#11744](https://github.com/Kilo-Org/kilocode/pull/11744) [`6d25c1b`](https://github.com/Kilo-Org/kilocode/commit/6d25c1bb16d6b7669745288f709a46117857c08d) - Allow the default TUI to import cloud-only sessions without rejecting their IDs as missing locally.

- [#11721](https://github.com/Kilo-Org/kilocode/pull/11721) [`be1f77d`](https://github.com/Kilo-Org/kilocode/commit/be1f77d4320603efbbfab0587a1dc0d9ec911001) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Expose Kilo Pass state on the Kilo profile API contract.

- [#11638](https://github.com/Kilo-Org/kilocode/pull/11638) [`117a0d6`](https://github.com/Kilo-Org/kilocode/commit/117a0d623346ba76e6efa1fa67a8ee94df89792e) - Stop loading `.opencode` config directories and use `.kilo` instead, while retaining `.kilocode` as a legacy fallback.

- [#11646](https://github.com/Kilo-Org/kilocode/pull/11646) [`61bbc34`](https://github.com/Kilo-Org/kilocode/commit/61bbc34eb261a27d2c56c8196a050929f8ef4e63) - Release disconnected event streams so long-running servers do not retain queued session diffs.

- [#11696](https://github.com/Kilo-Org/kilocode/pull/11696) [`be3ae82`](https://github.com/Kilo-Org/kilocode/commit/be3ae82962bff96b7caff4cc66424bcef3f41e84) - Remember sandbox choices per session and start new sessions with the last selected sandbox state.

- [#11703](https://github.com/Kilo-Org/kilocode/pull/11703) [`163aef5`](https://github.com/Kilo-Org/kilocode/commit/163aef56757b992c934046f2daad248e84bc98cc) - Prevent confined sessions and delegated agents from weakening their sandbox policy through configuration changes or unauthenticated server control.

- [#11591](https://github.com/Kilo-Org/kilocode/pull/11591) [`76a9d9b`](https://github.com/Kilo-Org/kilocode/commit/76a9d9b97c1802872f43904529927d29ef42a0d4) - Prevent sandboxed file tools from escaping project write roots through concurrent symlink replacement on macOS.

- [#11584](https://github.com/Kilo-Org/kilocode/pull/11584) [`588335e`](https://github.com/Kilo-Org/kilocode/commit/588335ef122487445f4d8925854179616bbe368a) - Confine sandboxed worktree sessions to their active worktree instead of allowing writes to sibling or primary checkouts.

- [#11556](https://github.com/Kilo-Org/kilocode/pull/11556) [`9b0c45c`](https://github.com/Kilo-Org/kilocode/commit/9b0c45ca382186a246e0f23ffe0c1c4efeaace24) - Show the concrete model reported for routed Kilo auto-model steps in CLI and VS Code session timelines, and break down TUI sidebar token usage, cache rate, and cost by model across subagent sessions.

- [#11621](https://github.com/Kilo-Org/kilocode/pull/11621) [`8ac629c`](https://github.com/Kilo-Org/kilocode/commit/8ac629ccc809cda8b5c3668ff57f5f15acc07c50) Thanks [@maoxin1234](https://github.com/maoxin1234)! - Surface the resumable `task_id` when a subagent stops on an error. Both foreground and background subagent failures now tell the parent agent that the session can be resumed via the task tool with `task_id="<id>"`, so a stopped subagent can be continued instead of being lost.

- [#11746](https://github.com/Kilo-Org/kilocode/pull/11746) [`5080c78`](https://github.com/Kilo-Org/kilocode/commit/5080c78e628b2598f01f9c5d9685d767340dec29) - Include session-tree IDs in model usage API responses and show full task token usage with a provider-grouped model breakdown in the VS Code session header.

- Updated dependencies [[`7b2063f`](https://github.com/Kilo-Org/kilocode/commit/7b2063f35440fd65e9ec2d38fd656da960ff48b6), [`123a939`](https://github.com/Kilo-Org/kilocode/commit/123a9395d2ec645c3dc247170188f42bbf7c9333), [`dcd2ae3`](https://github.com/Kilo-Org/kilocode/commit/dcd2ae3adb46f5a813451d9165ee075c91124003), [`1d798a1`](https://github.com/Kilo-Org/kilocode/commit/1d798a106f315dc3c1c4c78382eff7a6bd23343b), [`be1f77d`](https://github.com/Kilo-Org/kilocode/commit/be1f77d4320603efbbfab0587a1dc0d9ec911001), [`be3ae82`](https://github.com/Kilo-Org/kilocode/commit/be3ae82962bff96b7caff4cc66424bcef3f41e84), [`9b0c45c`](https://github.com/Kilo-Org/kilocode/commit/9b0c45ca382186a246e0f23ffe0c1c4efeaace24), [`2638e06`](https://github.com/Kilo-Org/kilocode/commit/2638e06ffbeff598672b671837380ef282f9f34c), [`5080c78`](https://github.com/Kilo-Org/kilocode/commit/5080c78e628b2598f01f9c5d9685d767340dec29)]:
  - @kilocode/sdk@7.4.0
  - @kilocode/kilo-gateway@7.3.55
  - @kilocode/plugin@7.3.55
  - @opencode-ai/ui@7.3.55
  - @kilocode/kilo-indexing@7.3.55
  - @kilocode/kilo-telemetry@7.3.55
  - @kilocode/plugin-atomic-chat@7.3.55

## 7.3.54

### Patch Changes

- [#11555](https://github.com/Kilo-Org/kilocode/pull/11555) [`5c1dcdf`](https://github.com/Kilo-Org/kilocode/commit/5c1dcdffca2fba153efe62a974727a066de25ba9) - Use the correct High and Max thinking variants for GLM 5.2 on OpenCode Go and compatible providers.

## 7.3.53

### Minor Changes

- [#11468](https://github.com/Kilo-Org/kilocode/pull/11468) [`27bd206`](https://github.com/Kilo-Org/kilocode/commit/27bd20680ce4be32ab69126169d0c56c77bf3b02) - Search titles and high-signal transcript content across all local sessions with the recall tool.

### Patch Changes

- [#11533](https://github.com/Kilo-Org/kilocode/pull/11533) [`15f42d4`](https://github.com/Kilo-Org/kilocode/commit/15f42d4bec51bbb127636738275f36fdc07e7b33) - Restore bounded text-file reads and keep zero-limit pagination and Unicode truncation from producing unusable tool output.

- Updated dependencies [[`6c55c28`](https://github.com/Kilo-Org/kilocode/commit/6c55c28ec345a6d90d2d7a4e345abf962f208e29)]:
  - @kilocode/kilo-gateway@7.3.53
  - @kilocode/kilo-indexing@7.3.53
  - @kilocode/kilo-telemetry@7.3.53
  - @opencode-ai/ui@7.3.53

## 7.3.52

### Patch Changes

- [#11450](https://github.com/Kilo-Org/kilocode/pull/11450) [`cc924a6`](https://github.com/Kilo-Org/kilocode/commit/cc924a67d9b190ccffebaefa983213e173db54d8) - Changes from opencode v1.15.9 to v1.15.13 upstream:
  - Core Improvements: Added `headerTimeout` config for provider requests, with a 10s default for default OpenAI setups.
  - Core Improvements: Experimental background agents now push updates without polling.
  - Core Improvements: You can now set only `modalities.input` or `modalities.output` in config. (@robposch)
  - Core Improvements: Remote-backed projects now resolve a stable project identity.
  - Core Improvements: ACP integrations can now send prompts, slash commands, and usage updates through `acp-next`
  - Core Improvements: Added WebSocket transport for OpenAI responses on supported channels (set KILO_EXPERIMENTAL_WEBSOCKETS=true)
  - Core Improvements: Sessions can now store custom metadata through the API and SDK. (@shantur)
  - Core Improvements: Config now loads from the opened location upward, so directory-specific settings and provider policies apply more predictably.
  - Core Bugfixes: Dynamically added MCP servers now disconnect cleanly when removed.
  - Core Bugfixes: DigitalOcean inference now uses your OAuth token directly instead of creating a MAK. (@Spherrrical)
  - Core Bugfixes: Config loading now falls back cleanly when user info is unavailable.
  - Core Bugfixes: Fixed Google tool calling after the upstream tool ID regression.
  - Core Bugfixes: Experimental flags can now override the umbrella experimental flag.
  - Core Bugfixes: Resumed sessions no longer continue orphaned interrupted tools. (@edevil)
  - Core Bugfixes: OpenAI reasoning summaries now render as separate blocks.
  - Core Bugfixes: Updated Google Vertex support for reasoning signatures.
  - Core Bugfixes: The shell tool now advertises your configured timeout to the model.
  - Core Bugfixes: Enabled adaptive reasoning controls for Anthropic Opus 4.7+ models
  - Core Bugfixes: Allowed colons in passwords (@neriousy)
  - Core Bugfixes: Sped up warm `acp-next` model and config switches
  - Core Bugfixes: Improved first-session `acp-next` startup time
  - Core Bugfixes: Kept OpenAI WebSocket response timeouts active
  - Core Bugfixes: Retried failed OpenAI WebSocket streams before falling back
  - Core Bugfixes: Handled `acp-next` permission prompts correctly
  - Core Bugfixes: Used the persisted session directory for existing-session requests
  - Core Bugfixes: Forwarded remote workspace request bodies correctly
  - Core Bugfixes: Supported custom base URLs for OpenAI WebSocket responses (@Tarquinen)
  - Core Bugfixes: Gateway Anthropic Opus 4.7+ adaptive reasoning now keeps summarized thinking instead of returning empty thinking blocks.
  - TUI Improvements: Made the prompt resize with terminal width and added prompt size config. (@bjschafer)
  - TUI Improvements: Added a workspace management dialog
  - TUI Bugfixes: Accelerated diff viewer scrolling.
  - TUI Bugfixes: External editors now open from the worktree directory when available.
  - TUI Bugfixes: Kept session navigation working while prompt modes are open
  - TUI Bugfixes: Restored the thinking spinner
  - TUI Bugfixes: Surfaced subagent retry status
  - TUI Bugfixes: Fixed opening editors from non-Git project paths (@OpeOginni)
  - TUI Bugfixes: Wrapped inline tool rows now stay aligned, and failed inline tools can expand their error details in place.
  - Extensions Improvements: Added a `dispose` hook for plugins.
  - Extensions Bugfixes: Fixed Codex plugin requests to send the expected session ID header.

## 7.3.51

### Minor Changes

- [#11478](https://github.com/Kilo-Org/kilocode/pull/11478) [`9611c8b`](https://github.com/Kilo-Org/kilocode/commit/9611c8b1ef2d623f7c486c5a0019ee0f590ce02d) - Support stopping the daemon with `kilo console stop` and keeping console or daemon commands attached with `--foreground`

- [#10005](https://github.com/Kilo-Org/kilocode/pull/10005) [`1d030dc`](https://github.com/Kilo-Org/kilocode/commit/1d030dcbbb6782181af684c8321b7349682bba5f) - Support `kilo run --command compact` and `--command summarize` to compact the current session, matching the TUI's `/compact` and `/summarize` slash commands.

## 7.3.50

### Minor Changes

- [#11421](https://github.com/Kilo-Org/kilocode/pull/11421) [`ccec216`](https://github.com/Kilo-Org/kilocode/commit/ccec2162383a6f378ed5e62d630720607d185209) - Show a BYOK badge for Kilo Gateway models that can use an enabled personal or organization provider key.

- [#11028](https://github.com/Kilo-Org/kilocode/pull/11028) [`a6ded9b`](https://github.com/Kilo-Org/kilocode/commit/a6ded9b60a65f41a9a68f65d8ababa478cf51f52) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Display local and network URLs when the server binds to 0.0.0.0

### Patch Changes

- [#11412](https://github.com/Kilo-Org/kilocode/pull/11412) [`2c9e72c`](https://github.com/Kilo-Org/kilocode/commit/2c9e72c14a87387199fd42546746bbea30aa1570) - Deny provider data collection for Kilo Gateway requests when prompt-training models are hidden.

- [#11301](https://github.com/Kilo-Org/kilocode/pull/11301) [`081b653`](https://github.com/Kilo-Org/kilocode/commit/081b65325f539a4c71db90ce9a89dba4cfa3226f) - Add a privacy filter to the Console model explorer that hides Kilo Gateway models whose providers may use prompts for training.

- [#11026](https://github.com/Kilo-Org/kilocode/pull/11026) [`e2ebf8b`](https://github.com/Kilo-Org/kilocode/commit/e2ebf8b7c8299cb42e68ef33e74507caef448206) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Skip automatic browser launch on Linux when no display is detected.

- [#11212](https://github.com/Kilo-Org/kilocode/pull/11212) [`8649ab6`](https://github.com/Kilo-Org/kilocode/commit/8649ab6dcd04e219b0d4bf98787fc4c2e9353c95) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Show docs URL in dialog when no display server is detected on headless Linux systems

- [#11319](https://github.com/Kilo-Org/kilocode/pull/11319) [`fb37d9c`](https://github.com/Kilo-Org/kilocode/commit/fb37d9c773791f3ec86379dcef9221797ce50f5c) Thanks [@grandmaster451](https://github.com/grandmaster451)! - Show the docs URL in an alert dialog when the browser cannot be opened on headless systems instead of silently failing.

- [#11455](https://github.com/Kilo-Org/kilocode/pull/11455) [`4d09333`](https://github.com/Kilo-Org/kilocode/commit/4d0933371ca9be212cdd0357605e250ebacf7e1b) - Hide reverted provider errors so Redo controls remain visible after rewinding a session.

- [#11475](https://github.com/Kilo-Org/kilocode/pull/11475) [`3d4ccc2`](https://github.com/Kilo-Org/kilocode/commit/3d4ccc25cf1caee91af93f50be127190bead2a23) - Preserve custom subagent tool permissions when tasks inherit restrictions from their parent agent.

- [#11453](https://github.com/Kilo-Org/kilocode/pull/11453) [`f7e68d1`](https://github.com/Kilo-Org/kilocode/commit/f7e68d19d9d8b23b087d3c7c92d487abced8d7ec) - Limit completion sounds to parent agent sessions.

- Updated dependencies [[`ccec216`](https://github.com/Kilo-Org/kilocode/commit/ccec2162383a6f378ed5e62d630720607d185209), [`2c9e72c`](https://github.com/Kilo-Org/kilocode/commit/2c9e72c14a87387199fd42546746bbea30aa1570), [`f7e68d1`](https://github.com/Kilo-Org/kilocode/commit/f7e68d19d9d8b23b087d3c7c92d487abced8d7ec)]:
  - @kilocode/kilo-gateway@7.4.0
  - @kilocode/sdk@7.3.50
  - @kilocode/kilo-indexing@7.3.50
  - @kilocode/kilo-telemetry@7.3.50
  - @kilocode/plugin@7.3.50
  - @opencode-ai/ui@7.3.50
  - @kilocode/plugin-atomic-chat@7.3.50

## 7.3.49

## 7.3.48

### Minor Changes

- [#11182](https://github.com/Kilo-Org/kilocode/pull/11182) [`973d02c`](https://github.com/Kilo-Org/kilocode/commit/973d02cfd15b3bf3eefefe92e7fb61059eba26f7) - Share the main codebase index with Agent Manager worktrees while indexing and searching only each worktree's changed files.

- [#10781](https://github.com/Kilo-Org/kilocode/pull/10781) [`66af690`](https://github.com/Kilo-Org/kilocode/commit/66af6907005b99bb39a0869b35dfe1ec180cc0b5) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Add opt-in Unicode or emoji terminal title indicators for sessions that are working, need attention, or have finished.

### Patch Changes

- [#11242](https://github.com/Kilo-Org/kilocode/pull/11242) [`9211000`](https://github.com/Kilo-Org/kilocode/commit/9211000aadd909f0d46746604c3e963966a59660) - Support unauthenticated OpenAI-compatible endpoints for codebase indexing without requiring a placeholder API key.

- [#11305](https://github.com/Kilo-Org/kilocode/pull/11305) [`04ed322`](https://github.com/Kilo-Org/kilocode/commit/04ed322aad65c43e7817535389ab6a45c247db75) - Prevent snapshot initialization progress from blocking conversations after the slow repository prompt.

- [#11249](https://github.com/Kilo-Org/kilocode/pull/11249) [`2c30dc7`](https://github.com/Kilo-Org/kilocode/commit/2c30dc75ce18c018f603a30d1c9e3c70fe8fc036) - Show a clear, retryable provider rate-limit error instead of raw response JSON in chat.

- [#11171](https://github.com/Kilo-Org/kilocode/pull/11171) [`04ebc74`](https://github.com/Kilo-Org/kilocode/commit/04ebc7413ce4e5e55ebc098c85c7cec449363ad9) - Hide TUI news after they have been opened and add a button to close the news dialog.

- [#10929](https://github.com/Kilo-Org/kilocode/pull/10929) [`9329682`](https://github.com/Kilo-Org/kilocode/commit/9329682775b19fb1ac0e4f08d3c1b3904b6815ea) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Make `/copy` copy the latest agent response and use `/copy-session` for session transcripts.

- [#10091](https://github.com/Kilo-Org/kilocode/pull/10091) [`be234fa`](https://github.com/Kilo-Org/kilocode/commit/be234fa92613cc47a69c116e6f297559f8c736eb) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Always deny tool calls for title, summarize, and compaction

- [#11264](https://github.com/Kilo-Org/kilocode/pull/11264) [`f78e54c`](https://github.com/Kilo-Org/kilocode/commit/f78e54c81c67a1b79af8b98ec4af3686aa716bfd) - Fix upgrades to resolve Kilo CLI packages and releases instead of OpenCode packages and versions.

- [#11347](https://github.com/Kilo-Org/kilocode/pull/11347) [`b518a76`](https://github.com/Kilo-Org/kilocode/commit/b518a76aea020b3320666aa0a69a113516d0a1e0) - Identify Kilo in provider request user-agent headers instead of OpenCode.

- [#11279](https://github.com/Kilo-Org/kilocode/pull/11279) [`e91eef2`](https://github.com/Kilo-Org/kilocode/commit/e91eef2b384e64ffdbbd5d9fad99d534ecb7a2e8) - Show current-worktree sessions by default in the TUI sessions dialog and keep all/current scope toggling working when a scope has no sessions.

- [#11158](https://github.com/Kilo-Org/kilocode/pull/11158) [`8ff8371`](https://github.com/Kilo-Org/kilocode/commit/8ff83711766ff6b18ea23d1990d6fedd8e79c5ae) - Add a shared model setting to hide Kilo Gateway models that may train on your prompts across Kilo clients.

- [#11270](https://github.com/Kilo-Org/kilocode/pull/11270) [`c5d39d0`](https://github.com/Kilo-Org/kilocode/commit/c5d39d090c34f9fea834718a799bb921ee69df3c) - Replace remaining OpenCode-branded CLI and TUI copy with Kilo branding.

- [#11279](https://github.com/Kilo-Org/kilocode/pull/11279) [`2f69c13`](https://github.com/Kilo-Org/kilocode/commit/2f69c132b0d968e08a139681305471fc3ca627ed) - Show Agent Manager and other Git worktrees in the Kilo Console project view.

- [#11291](https://github.com/Kilo-Org/kilocode/pull/11291) [`4436139`](https://github.com/Kilo-Org/kilocode/commit/4436139fab57ccb65c33ac3d303f38a9efd4733b) - Load the bundled Atomic Chat integration without attempting to install an unpublished npm plugin.

- [#11236](https://github.com/Kilo-Org/kilocode/pull/11236) [`1511d13`](https://github.com/Kilo-Org/kilocode/commit/1511d13b3f7f20001d2111f14bdfae7155372cf8) Thanks [@kapelame](https://github.com/kapelame)! - Add an instant/thinking reasoning toggle for MiniMax M-series models, matching the existing glm/kimi/qwen behavior.

- [#11170](https://github.com/Kilo-Org/kilocode/pull/11170) [`3845918`](https://github.com/Kilo-Org/kilocode/commit/38459184f27a5a22d9314fcb6e113ddec7b2f0e2) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Make native Plan mode follow Architect-style planning behavior while preserving Plan mode restrictions and repo-root plan files.

- [#11257](https://github.com/Kilo-Org/kilocode/pull/11257) [`f42789d`](https://github.com/Kilo-Org/kilocode/commit/f42789d0ef5585aad4080bdc5c96856675cd9503) - Changes from opencode v1.14.51 to v1.15.4 upstream:
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

- [#11356](https://github.com/Kilo-Org/kilocode/pull/11356) [`326ff35`](https://github.com/Kilo-Org/kilocode/commit/326ff351460342f93b0bf97f0beb6383357c5d05) - Changes from opencode v1.15.4 to v1.15.9 upstream:
  - Core Improvements: Preview the native OpenAI runtime path behind an experimental flag
  - Core Improvements: Add `--replay` and `--replay-limit` to show recent history when resuming interactive runs
  - Core Improvements: Added a diff viewer in the TUI for reviewing changes.
  - Core Improvements: Collapsed single-child directories in the diff viewer file tree.
  - Core Improvements: Added shell mode to the `run` prompt.
  - Core Improvements: Replaced subagent tabs with an on-demand picker in `run`.
  - Core Improvements: Plugin file load errors no longer break the rest of plugin loading.
  - Core Improvements: Anthropic API-key models now use the native runtime.
  - Core Improvements: The v2 HTTP API now exposes structured public error schemas.
  - Core Improvements: Added Grok OAuth sign-in, including device-code login. (@Jaaneek)
  - Core Improvements: Redesigned the diff viewer with a file tree and refreshed layout.
  - Core Bugfixes: Fix plugin tools using `ask` so tool calls complete correctly
  - Core Bugfixes: Reduce missed `/event` updates caused by a subscription race
  - Core Bugfixes: Sort the v2 session list by most recently updated
  - Core Bugfixes: Zed editor context now only activates inside Zed terminals.
  - Core Bugfixes: Agent and command names now resolve correctly from relative config paths.
  - Core Bugfixes: Invalid `KILO_PERMISSION` JSON no longer crashes startup.
  - Core Bugfixes: Plugin tools with missing `args` no longer break tool loading.
  - Core Bugfixes: Restored legacy `PgUp` and `PgDn` TUI keybind aliases.
  - Core Bugfixes: Native runtime now prefers the console provider token for OpenCode models.
  - Core Bugfixes: V2 session APIs now return safe `UnknownError` responses with log reference IDs when stored messages are corrupt.
  - Core Bugfixes: Generic API 500s no longer expose config details from server errors.
  - Core Bugfixes: Unknown API errors now include reference IDs so you can match responses to server logs.
  - Core Bugfixes: V2 session APIs now return `503 ServiceUnavailableError` for mutations that are not available yet.
  - Core Bugfixes: V2 session APIs now return `SessionNotFoundError` for missing sessions.
  - Core Bugfixes: Deduped concurrent Codex OAuth refreshes to avoid repeated refresh failures. (@cooper-oai)
  - Core Bugfixes: Restored native OpenAI OAuth requests.
  - Core Bugfixes: Tool schema failures now surface as friendly tool errors.
  - Core Bugfixes: Added PDF attachment support for Grok.
  - Core Bugfixes: Restored OpenAI reasoning streams.
  - Core Bugfixes: Return to the previous screen when closing the diff viewer.
  - Core Bugfixes: Show clearer errors when a default model is invalid or unavailable.
  - Core Bugfixes: Surface missing PTY session errors instead of failing generically.
  - Core Bugfixes: Improve diff viewer empty states and context handling.
  - Core Bugfixes: Show clearer errors when a skill invocation fails as expected.
  - Core Bugfixes: Show clearer errors when an installation upgrade fails.
  - Core Bugfixes: Show clearer project not found errors from the HTTP API.
  - Core Bugfixes: Return PTY error bodies from the HTTP API.
  - Core Bugfixes: Enable the diff viewer by default.
  - Core Bugfixes: Return MCP server not found errors from the HTTP API.
  - Core Bugfixes: Let MCP OAuth configs set a callback port and include configured scopes in client metadata. (@sebin)
  - Core Bugfixes: Use working Vertex Anthropic endpoints for `us` and `eu` multi-region setups. (@JPFrancoia)
  - Core Bugfixes: Return session busy error bodies from the HTTP API.
  - Core Bugfixes: Preserve native reasoning continuation metadata across turns.
  - TUI Improvements: Refresh the prompt layout after pasting content
  - TUI Improvements: The diff viewer now focuses the first file automatically.
  - TUI Improvements: Copy the current worktree path from the command palette.
  - TUI Bugfixes: Keep file references scoped to the current workspace
  - TUI Bugfixes: Preserve pasted prompt content when copying
  - TUI Bugfixes: Collapse very long tool output lines to keep the layout readable
  - TUI Bugfixes: Use a higher-contrast paste summary badge color in some themes (@kagura-agent)
  - TUI Bugfixes: Imported sessions now refresh their directory and relative path fields correctly. (@OpeOginni)
  - TUI Bugfixes: Collapsed thinking labels now use clearer punctuation.
  - TUI Bugfixes: New sessions now default to the local project.
  - TUI Bugfixes: Single-select question checkmarks no longer run into option labels.
  - TUI Bugfixes: Refine diff viewer keyboard shortcuts.
  - TUI Bugfixes: Restore question prompt key handling.
  - TUI Bugfixes: Keep the spinner color aligned with the active agent. (@OpeOginni)

- [#11245](https://github.com/Kilo-Org/kilocode/pull/11245) [`046b03a`](https://github.com/Kilo-Org/kilocode/commit/046b03a19de2b4017211efb70d0641499789efa8) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Restore session timestamp prefixes for generated plan filenames while preserving descriptive model-chosen names.

- [#9807](https://github.com/Kilo-Org/kilocode/pull/9807) [`9394100`](https://github.com/Kilo-Org/kilocode/commit/93941001f6211622318dab1a7e6ec6c420dbd612) Thanks [@truffle-dev](https://github.com/truffle-dev)! - Prevent unreachable telemetry endpoints from blocking or failing completed CLI commands.

- [#11279](https://github.com/Kilo-Org/kilocode/pull/11279) [`8c1cdf5`](https://github.com/Kilo-Org/kilocode/commit/8c1cdf53a94a00f914a3c7f392b2569d422985ad) - Keep expanded Kilo Console file diffs open while resizing the context sidebar.

- [#11279](https://github.com/Kilo-Org/kilocode/pull/11279) [`2f69c13`](https://github.com/Kilo-Org/kilocode/commit/2f69c132b0d968e08a139681305471fc3ca627ed) - Keep Kilo Console terminal sessions open when changing diff layout and other console preferences.

- [#11354](https://github.com/Kilo-Org/kilocode/pull/11354) [`b2eef5c`](https://github.com/Kilo-Org/kilocode/commit/b2eef5cff413d8e61798e9187c9740fd0ac7273f) - Prevent the bundled Atomic Chat plugin from triggering an npm installation.

- [#11373](https://github.com/Kilo-Org/kilocode/pull/11373) [`f21a34a`](https://github.com/Kilo-Org/kilocode/commit/f21a34a1e63107da085eb9e57172ca6025d2dbe0) - Skip attention sounds when a session is manually interrupted.

- [#11295](https://github.com/Kilo-Org/kilocode/pull/11295) [`2fa0890`](https://github.com/Kilo-Org/kilocode/commit/2fa0890928f7dd060125ad4f4083b8bd2bf3e69b) - Restore speech input when profile details are unavailable, move transcription model selection to the Models tab, and default transcription to Whisper Large V3 Turbo.

- [#9758](https://github.com/Kilo-Org/kilocode/pull/9758) [`8db7b68`](https://github.com/Kilo-Org/kilocode/commit/8db7b685837e015dc922825f03641a221e5becf7) - Restore files to their original paths when reverting a task that moved or renamed them.

- [#11410](https://github.com/Kilo-Org/kilocode/pull/11410) [`344a6a5`](https://github.com/Kilo-Org/kilocode/commit/344a6a5f0f8377d8ab38792e6141d08947a7dc19) - Keep server controls and events connected to active sessions and subagents.

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`987da27`](https://github.com/Kilo-Org/kilocode/commit/987da2728731e1da1c974996b5bcddafe745cea7) - Show shared provider descriptions and provider icons in JetBrains and VS Code provider settings.

- [#11262](https://github.com/Kilo-Org/kilocode/pull/11262) [`0903183`](https://github.com/Kilo-Org/kilocode/commit/090318379956d5fd200fa3182b525f746ed6a442) - Expose the prompt-training model filter in the Kilo Console model settings.

- [#10758](https://github.com/Kilo-Org/kilocode/pull/10758) [`e511b23`](https://github.com/Kilo-Org/kilocode/commit/e511b230ab87c3b1a594a7e1ac12e44a096a813f) Thanks [@cooper-oai](https://github.com/cooper-oai)! - Prevent concurrent Kilo processes from reusing a ChatGPT Codex refresh token.

- Updated dependencies [[`9211000`](https://github.com/Kilo-Org/kilocode/commit/9211000aadd909f0d46746604c3e963966a59660), [`2fa0890`](https://github.com/Kilo-Org/kilocode/commit/2fa0890928f7dd060125ad4f4083b8bd2bf3e69b), [`973d02c`](https://github.com/Kilo-Org/kilocode/commit/973d02cfd15b3bf3eefefe92e7fb61059eba26f7), [`66af690`](https://github.com/Kilo-Org/kilocode/commit/66af6907005b99bb39a0869b35dfe1ec180cc0b5)]:
  - @kilocode/kilo-indexing@7.4.0
  - @kilocode/sdk@7.4.0
  - @kilocode/plugin@7.3.47
  - @opencode-ai/ui@7.3.47
  - @kilocode/kilo-gateway@7.3.47
  - @kilocode/plugin-atomic-chat@7.3.47
  - @kilocode/kilo-telemetry@7.3.47

## 7.3.46

### Patch Changes

- [#11184](https://github.com/Kilo-Org/kilocode/pull/11184) [`adf03a9`](https://github.com/Kilo-Org/kilocode/commit/adf03a98245e8877c580cb1f77a7e0ea4f0af61d) - Support model-specific reasoning overrides for task subagents, including custom subagents with their own model and variant settings.

- [#11178](https://github.com/Kilo-Org/kilocode/pull/11178) [`f63e771`](https://github.com/Kilo-Org/kilocode/commit/f63e77153cde1d9f1c3bf62e5aa543c07bf5f506) - Accelerate initial snapshots for regular Git sessions while preserving existing changes and asynchronously storing snapshots independently from the source repository.

- Restore Kilo branding, fork-specific CLI commands, and CLI lifecycle initialization after upstream merges.

- [#11240](https://github.com/Kilo-Org/kilocode/pull/11240) [`f820e57`](https://github.com/Kilo-Org/kilocode/commit/f820e57bab6c1ddd26f73964160bee7134488b96) - Prevent skill removal from recursively deleting working directories.

- [#11179](https://github.com/Kilo-Org/kilocode/pull/11179) [`96a1610`](https://github.com/Kilo-Org/kilocode/commit/96a16102b2a6c22f0860641d7f78c076835c0c99) - Validate GitHub attachments and language server release paths before downloading or executing them.

## 7.3.45

### Patch Changes

- [#11152](https://github.com/Kilo-Org/kilocode/pull/11152) [`b23d3df`](https://github.com/Kilo-Org/kilocode/commit/b23d3dfd756461ae02e2ed2872aded09d65dc1af) - Allow Escape to stop Agent Manager prompts while their sessions are still starting.

- [#11138](https://github.com/Kilo-Org/kilocode/pull/11138) [`e354305`](https://github.com/Kilo-Org/kilocode/commit/e35430580be89361304c4b599ccd7eeb62fce7c1) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Restart the daemon when `kilo console` or `kilo daemon start` receives explicit network options that don't match the running daemon, instead of silently ignoring the requested settings.

## 7.3.44

### Minor Changes

- [#11082](https://github.com/Kilo-Org/kilocode/pull/11082) [`a16e82a`](https://github.com/Kilo-Org/kilocode/commit/a16e82a77abf883c2c07c11464d50e08a518acd7) - Use embedded LanceDB as the default semantic search vector store so indexing works without a separate Qdrant server. Existing Qdrant users and Intel Mac users can select `qdrant` with `indexing.vectorStore`.

### Patch Changes

- [#10922](https://github.com/Kilo-Org/kilocode/pull/10922) [`bc3af9a`](https://github.com/Kilo-Org/kilocode/commit/bc3af9a145c8bd5f90fa0c9b22a48cceb095f8b4) - Prevent unnecessary repeat auto-compactions when providers report inconsistent token totals.

- [#11160](https://github.com/Kilo-Org/kilocode/pull/11160) [`78d83c0`](https://github.com/Kilo-Org/kilocode/commit/78d83c0651d5343c0f9f877265dc5136cd7761f0) - Preserve the calling model's reasoning effort when task subagents inherit that model.

- [#10478](https://github.com/Kilo-Org/kilocode/pull/10478) [`5bc8df8`](https://github.com/Kilo-Org/kilocode/commit/5bc8df843a2492d2eee01963b5a2c1a55beab56c) - Allow hosted runtimes to cap shell command duration and explain environment-enforced timeouts.

- [#11085](https://github.com/Kilo-Org/kilocode/pull/11085) [`2a6596b`](https://github.com/Kilo-Org/kilocode/commit/2a6596b0c578b20ea803fa69a8427fc3e4c2e823) - Indicate when no models are available in model-not-found errors.

- [#11072](https://github.com/Kilo-Org/kilocode/pull/11072) [`6920f37`](https://github.com/Kilo-Org/kilocode/commit/6920f37b77f820d9f8542d352cf60e061670933b) - Speed up the first Agent Manager prompt in new worktrees by seeding snapshots from the checkout's Git index.

- [#11075](https://github.com/Kilo-Org/kilocode/pull/11075) [`e17ce0c`](https://github.com/Kilo-Org/kilocode/commit/e17ce0c9ecaf4cc4cad3e0fd99b28bef561705fc) - Speed up large session forks by retaining final task outcomes instead of duplicating resumable subagent histories, and load completed task details only when expanded.

- [#11143](https://github.com/Kilo-Org/kilocode/pull/11143) [`12144cf`](https://github.com/Kilo-Org/kilocode/commit/12144cf8275200a7dd8e29cf478c39504da59b04) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Warn when `kilo console` or `kilo daemon` is invoked with an explicit `--port` outside the discovery range (4097–4116).

- [#11006](https://github.com/Kilo-Org/kilocode/pull/11006) [`69a0b38`](https://github.com/Kilo-Org/kilocode/commit/69a0b384e6c61d190241087f88f2be4312e7517e) - Refresh connected provider model lists when the models catalog updates.

- [#11081](https://github.com/Kilo-Org/kilocode/pull/11081) [`9c279a1`](https://github.com/Kilo-Org/kilocode/commit/9c279a16b4a14fc117f34d7aa19e771149031931) - Show model free and prompt-training indicators only when their explicit catalog metadata is enabled.

- [#11101](https://github.com/Kilo-Org/kilocode/pull/11101) [`294c532`](https://github.com/Kilo-Org/kilocode/commit/294c532f6a355b78ed86d2188891883b07e90cc8) - Prevent task subagents from asking questions that users cannot answer from the parent session.

- [#11102](https://github.com/Kilo-Org/kilocode/pull/11102) [`8a72708`](https://github.com/Kilo-Org/kilocode/commit/8a727084ae0327fbf195149660c19d2215fb558a) - Prevent duplicate CLI attention alerts and route Kilo prompts through the configurable notification system.

- [#10866](https://github.com/Kilo-Org/kilocode/pull/10866) [`d5112ed`](https://github.com/Kilo-Org/kilocode/commit/d5112edf90d33333d1064c7ab885cf0a4d92d892) - Stabilize code indexing workers, retry Kilo model catalog downloads, reduce progress log noise, and show indexing failures as TUI notifications instead of writing over the terminal interface.

- [#11147](https://github.com/Kilo-Org/kilocode/pull/11147) [`9a187d5`](https://github.com/Kilo-Org/kilocode/commit/9a187d5aad5c3bf90a6dac589a0b26069057c3b0) - Configure the project context sidebar width and default diff layout from Global Settings.

- [#11091](https://github.com/Kilo-Org/kilocode/pull/11091) [`57bef8a`](https://github.com/Kilo-Org/kilocode/commit/57bef8ae68793c9b627ba0400b596bf932311e17) - Prevent streamed tool calls from executing twice and leaving answered questions disabled in VS Code.

- [#11139](https://github.com/Kilo-Org/kilocode/pull/11139) [`7226635`](https://github.com/Kilo-Org/kilocode/commit/72266359d497f407f951c1b468a50d3093ec9dc3) - Restore Kilo branding, fork-specific CLI commands, and CLI lifecycle initialization after upstream merges.

- [#11031](https://github.com/Kilo-Org/kilocode/pull/11031) [`bbfd59b`](https://github.com/Kilo-Org/kilocode/commit/bbfd59b85c383277fd8db77fcfd0ec56ea1a25d8) - Remove the unsupported code search tool.

- [#11117](https://github.com/Kilo-Org/kilocode/pull/11117) [`b75af0d`](https://github.com/Kilo-Org/kilocode/commit/b75af0de8865234a745f71eac03bf2bdea2271b4) - Update the Vercel AI SDK providers for Cerebras, xAI, and OpenAI-compatible endpoints.

- [#10866](https://github.com/Kilo-Org/kilocode/pull/10866) [`d5112ed`](https://github.com/Kilo-Org/kilocode/commit/d5112edf90d33333d1064c7ab885cf0a4d92d892) - Support configuring code indexing separately for global and project settings in Kilo Console, the CLI TUI, and VS Code.

- [#11031](https://github.com/Kilo-Org/kilocode/pull/11031) [`28a26b1`](https://github.com/Kilo-Org/kilocode/commit/28a26b11c133686a4656af8be21af619c919301a) - Restore streamed responses in the CLI TUI and move code indexing status into the session sidebar.

- Updated dependencies [[`a16e82a`](https://github.com/Kilo-Org/kilocode/commit/a16e82a77abf883c2c07c11464d50e08a518acd7), [`9c279a1`](https://github.com/Kilo-Org/kilocode/commit/9c279a16b4a14fc117f34d7aa19e771149031931), [`57bef8a`](https://github.com/Kilo-Org/kilocode/commit/57bef8ae68793c9b627ba0400b596bf932311e17), [`b75af0d`](https://github.com/Kilo-Org/kilocode/commit/b75af0de8865234a745f71eac03bf2bdea2271b4)]:
  - @kilocode/kilo-indexing@7.4.0
  - @kilocode/kilo-gateway@7.3.43
  - @kilocode/kilo-telemetry@7.3.43
  - @opencode-ai/ui@7.3.43

## 7.3.42

### Patch Changes

- [#11064](https://github.com/Kilo-Org/kilocode/pull/11064) [`db7707d`](https://github.com/Kilo-Org/kilocode/commit/db7707d49c4bb3d3cb6f0a44a62787d9d05e88f6) - Allow local review follow-up fix prompts to modify code after explicit user approval.

- [#11050](https://github.com/Kilo-Org/kilocode/pull/11050) [`8535d3d`](https://github.com/Kilo-Org/kilocode/commit/8535d3d51bef513c0034085e4422355f5be72bf3) - Keep new Kilo Console terminals open in the TUI on macOS.

- [#11011](https://github.com/Kilo-Org/kilocode/pull/11011) [`9f072b0`](https://github.com/Kilo-Org/kilocode/commit/9f072b05d49554648adbaca251a1ec5800b7b0fc) - Re-enable free-model session and Git workspace data export.

- [#10751](https://github.com/Kilo-Org/kilocode/pull/10751) [`6e8d6f7`](https://github.com/Kilo-Org/kilocode/commit/6e8d6f7d5354d5380c165482c6af87baceca07bd) - Sync CLI sessions to Kilo session history when authenticated with `KILO_API_KEY` when no stored Kilo auth is present.

## 7.3.41

### Minor Changes

- [#10761](https://github.com/Kilo-Org/kilocode/pull/10761) [`82b22f7`](https://github.com/Kilo-Org/kilocode/commit/82b22f78580fb5dafee55960135edfb1066d1520) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Support reading .ods (OpenDocument Spreadsheet) files in the read tool

- [#10879](https://github.com/Kilo-Org/kilocode/pull/10879) [`b0a4f03`](https://github.com/Kilo-Org/kilocode/commit/b0a4f0391106a837b78200e6de52621a6872b890) - Show Terminal Bench completion scores and per-attempt costs in supported model details.

- [#10948](https://github.com/Kilo-Org/kilocode/pull/10948) [`6ee090b`](https://github.com/Kilo-Org/kilocode/commit/6ee090b5a404924f00c1f4771b09c1f4a1e352ca) - Restore cloud session filesystem changes from synced session diffs when importing sessions, including inherited changes across imported session forks.

### Patch Changes

- [#10996](https://github.com/Kilo-Org/kilocode/pull/10996) [`cc03ffc`](https://github.com/Kilo-Org/kilocode/commit/cc03ffc58100cddbf4e0ab1ce9ccee89afe5726c) - Preserve image attachments when Photon is unavailable, enforce attachment limits for user images, and correlate shell lifecycle events correctly.

- [#10998](https://github.com/Kilo-Org/kilocode/pull/10998) [`a59b255`](https://github.com/Kilo-Org/kilocode/commit/a59b255b3110411b8e05a09215bb9908f8dc6462) - Restore automatic session titles for models that require reasoning without assuming a supported effort level.

- [#11004](https://github.com/Kilo-Org/kilocode/pull/11004) [`16e334f`](https://github.com/Kilo-Org/kilocode/commit/16e334ff8ca5305b7da379710a41056a6a6752fc) - Discover project-installed skills in Agent Manager worktree sessions.

- [#11000](https://github.com/Kilo-Org/kilocode/pull/11000) [`741b00f`](https://github.com/Kilo-Org/kilocode/commit/741b00f2e0a6a94574c506a276688fc6ca033df5) - Keep subagent sessions isolated when forking sessions through editor clients.

- [#10991](https://github.com/Kilo-Org/kilocode/pull/10991) [`ece8453`](https://github.com/Kilo-Org/kilocode/commit/ece8453ad0e8decc39f3c2a3d05893fd70b0985b) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Avoid copying visible planning chat into new sessions started from the plan follow-up prompt.

- [#11034](https://github.com/Kilo-Org/kilocode/pull/11034) [`0d76fa6`](https://github.com/Kilo-Org/kilocode/commit/0d76fa627349061d69fd4f5d6f486640d8d7834e) - Start forked sessions at zero cost instead of carrying over the source session's spend.

- [#10109](https://github.com/Kilo-Org/kilocode/pull/10109) [`df30123`](https://github.com/Kilo-Org/kilocode/commit/df30123e5474cdbd2ad3b56d59c6eb5d06b89189) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Prevent memory leak in KiloSessionPromptQueue.cancel for sessions without active tails

- [#11010](https://github.com/Kilo-Org/kilocode/pull/11010) [`a130641`](https://github.com/Kilo-Org/kilocode/commit/a13064167df50862e9a4a8622e092ac518110281) - Compact sessions at the configured context percentage before sending an oversized provider request.

- Updated dependencies [[`b0a4f03`](https://github.com/Kilo-Org/kilocode/commit/b0a4f0391106a837b78200e6de52621a6872b890)]:
  - @kilocode/kilo-gateway@7.4.0
  - @kilocode/kilo-indexing@7.3.41
  - @kilocode/kilo-telemetry@7.3.41

## 7.3.40

### Patch Changes

- [#10925](https://github.com/Kilo-Org/kilocode/pull/10925) [`881a451`](https://github.com/Kilo-Org/kilocode/commit/881a451f8ac198c9d199616c1eef20e94ff25b57) Thanks [@evanjacobson](https://github.com/evanjacobson)! - Display skills in CLI slash command autocomplete options

- [#10952](https://github.com/Kilo-Org/kilocode/pull/10952) [`be5f42f`](https://github.com/Kilo-Org/kilocode/commit/be5f42f158ee88777cc37160cb94dd58b74c6247) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Support custom plan file paths when exiting planning.

## 7.3.39

### Patch Changes

- [#10901](https://github.com/Kilo-Org/kilocode/pull/10901) [`a8a8dd8`](https://github.com/Kilo-Org/kilocode/commit/a8a8dd87247a700e83d8b9cbedc7a4a26cdea602) - Prevent icon images fetched from the web from causing provider request errors.

- [#10933](https://github.com/Kilo-Org/kilocode/pull/10933) [`a0eb3b7`](https://github.com/Kilo-Org/kilocode/commit/a0eb3b7cb6e06a6d9d625169eaefaffb4b4f7095) - Write strict JSON when adding MCP servers to `kilo.json` configuration files.

- [#10924](https://github.com/Kilo-Org/kilocode/pull/10924) [`189f251`](https://github.com/Kilo-Org/kilocode/commit/189f251866fb9e2971384377d1494b03e6d8889d) - Temporarily disable free-model session and Git workspace data export.

- [#10949](https://github.com/Kilo-Org/kilocode/pull/10949) [`78117d1`](https://github.com/Kilo-Org/kilocode/commit/78117d1a25cc7fe408a5933c117bf76062a7aaf2) - Fail publication builds when the bundled models snapshot cannot be downloaded or validated, and load the snapshot as JSON data in compiled binaries.

## 7.3.33

### Patch Changes

- [#10935](https://github.com/Kilo-Org/kilocode/pull/10935) [`6cab5f1`](https://github.com/Kilo-Org/kilocode/commit/6cab5f18e76b5ab0f738c2e20e93f12f3679b5dc) - Prevent the macOS Apple Silicon CLI from failing to start because of malformed bundled exports.

## 7.3.30

### Patch Changes

- [#10862](https://github.com/Kilo-Org/kilocode/pull/10862) [`c4de1ac`](https://github.com/Kilo-Org/kilocode/commit/c4de1acdf0aef967b5795fde006c6f61e16328f3) - Support reasoning with Mistral Medium 3.5 models, including the latest alias.

- [#10895](https://github.com/Kilo-Org/kilocode/pull/10895) [`2e1945c`](https://github.com/Kilo-Org/kilocode/commit/2e1945c287971f26bec67b7e60de6c282a5c8865) - Allow plan approval submissions to complete after planning finishes.

## 7.3.29

### Patch Changes

- [#10822](https://github.com/Kilo-Org/kilocode/pull/10822) [`8b1ee66`](https://github.com/Kilo-Org/kilocode/commit/8b1ee6628c7ee552814980465af7233522dd5528) - Preserve worktree routing for Kilo HTTP API clients and keep inherited task-subagent restrictions active.

## 7.3.28

### Patch Changes

- [#10847](https://github.com/Kilo-Org/kilocode/pull/10847) [`cdf46c9`](https://github.com/Kilo-Org/kilocode/commit/cdf46c97354630e2f1b392092ee0ffcc18b19640) - Clarify when free-model data may be used for training and identify it with a brain circuit icon.

- [#10833](https://github.com/Kilo-Org/kilocode/pull/10833) [`8696edc`](https://github.com/Kilo-Org/kilocode/commit/8696edcb542a5a499018184cfc9aa15cc896e5de) - Keep Kilo Console terminals and worktree changes visible while refreshing diffs.

- [#10833](https://github.com/Kilo-Org/kilocode/pull/10833) [`fbacc31`](https://github.com/Kilo-Org/kilocode/commit/fbacc312f747b6f2284d23c9f58bdc7a843a81cd) - Use the updated favicon in Kilo Console.

- [#10865](https://github.com/Kilo-Org/kilocode/pull/10865) [`9c56107`](https://github.com/Kilo-Org/kilocode/commit/9c561074b624925d14ee0e7d9e64d0a6f5958531) - Show the animated Kilo logo while the console and dashboard finish loading.

- [#10864](https://github.com/Kilo-Org/kilocode/pull/10864) [`557d6ad`](https://github.com/Kilo-Org/kilocode/commit/557d6ad02392dac9138d9788da1476a7ff9cc8e2) - Preserve upstream error statuses for cloud session and KiloClaw gateway requests.

- [#10831](https://github.com/Kilo-Org/kilocode/pull/10831) [`837a875`](https://github.com/Kilo-Org/kilocode/commit/837a87509cb323dbf212cbf40af112f218221dd0) - Keep post-compaction tool calls and follow-up messages ordered after the compaction summary in the CLI and VS Code transcript.

- [#10849](https://github.com/Kilo-Org/kilocode/pull/10849) [`a6b005d`](https://github.com/Kilo-Org/kilocode/commit/a6b005dfede302731dcbb00ac74e744333db9104) - Restore Cloud Agent transcripts in VS Code session previews and stop cloud session previews or continuation from loading indefinitely when a request stalls.

- [#10883](https://github.com/Kilo-Org/kilocode/pull/10883) [`1cdc398`](https://github.com/Kilo-Org/kilocode/commit/1cdc39856f461b4dc183fe5b273b7fc1314b9a64) - Restore `kilo console` startup in packaged CLI builds.

- [#10863](https://github.com/Kilo-Org/kilocode/pull/10863) [`35aa9bb`](https://github.com/Kilo-Org/kilocode/commit/35aa9bbbb38557df292f105fd5324bf37807f518) - Restore Kilo Gateway-backed Mercury Next Edit completions.

- [#10829](https://github.com/Kilo-Org/kilocode/pull/10829) [`e64c1fb`](https://github.com/Kilo-Org/kilocode/commit/e64c1fb65ec6895f7e97786f52806195f25606c0) - Restore full-session forks in Agent Manager after the HTTP API migration.

- Updated dependencies [[`fc4cf10`](https://github.com/Kilo-Org/kilocode/commit/fc4cf10b0a65ec2b2949dd695ebec6ebb619cd15), [`a6b005d`](https://github.com/Kilo-Org/kilocode/commit/a6b005dfede302731dcbb00ac74e744333db9104)]:
  - @kilocode/sdk@7.3.23
  - @kilocode/kilo-gateway@7.3.23
  - @kilocode/plugin@7.3.23
  - @kilocode/kilo-indexing@7.3.23
  - @kilocode/kilo-telemetry@7.3.23

## 7.3.21

### Minor Changes

- [#10298](https://github.com/Kilo-Org/kilocode/pull/10298) [`ac7e46d`](https://github.com/Kilo-Org/kilocode/commit/ac7e46d67a7015469bf2edeb573c284308ea05d5) Thanks [@Githubguy132010](https://github.com/Githubguy132010)! - Add a `kilo profile` command for checking the active Kilo account or team balance.

- [#10310](https://github.com/Kilo-Org/kilocode/pull/10310) [`c265fa4`](https://github.com/Kilo-Org/kilocode/commit/c265fa4c4ef18204f8e2741c66953c24bf012f2a) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Show running spinner in subagent footer to indicate when subagent is processing

### Patch Changes

- [#10191](https://github.com/Kilo-Org/kilocode/pull/10191) [`b590f8c`](https://github.com/Kilo-Org/kilocode/commit/b590f8c25f1af82e7df854b5b969ae8749118bba) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Handle newlines in DialogAlert messages

- [#10306](https://github.com/Kilo-Org/kilocode/pull/10306) [`aca8aeb`](https://github.com/Kilo-Org/kilocode/commit/aca8aeb2b91679b52937562d45986562440ac1de) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Toggle export dialog checkboxes on mouse click

## 7.3.20

### Patch Changes

- [#10792](https://github.com/Kilo-Org/kilocode/pull/10792) [`cb1fdb3`](https://github.com/Kilo-Org/kilocode/commit/cb1fdb3b1b824c6f91cb05dc568bd37f6bf494f5) - Allow clearing agent model and variant overrides from settings.

- [#10786](https://github.com/Kilo-Org/kilocode/pull/10786) [`7dd8aab`](https://github.com/Kilo-Org/kilocode/commit/7dd8aabadeb1b5bcf69f5fb9545a57ac91daf54f) - Limit inferred background-process port discovery to the TUI and stop scanning after startup to avoid unnecessary Bun subprocess polling.

- [#10735](https://github.com/Kilo-Org/kilocode/pull/10735) [`593903f`](https://github.com/Kilo-Org/kilocode/commit/593903fb5ce8843d1a84a64787f8103b92a31fee) - Fix Claude Opus 4.8 reasoning on Amazon Bedrock by treating it as an adaptive thinking model like Opus 4.7. This resolves the "thinking.type.enabled is not supported for this model" error and exposes the full low/medium/high/xhigh/max reasoning effort range.

- [#10789](https://github.com/Kilo-Org/kilocode/pull/10789) [`316a662`](https://github.com/Kilo-Org/kilocode/commit/316a6627dc9eccd40bf7aa45366fca40b35f1879) - Fix queued plan prompts stalling in VS Code after a completed turn.

- [#9499](https://github.com/Kilo-Org/kilocode/pull/9499) [`c1c3af8`](https://github.com/Kilo-Org/kilocode/commit/c1c3af8bf42e911d9d2a2cf06937fdf056d851d2) Thanks [@truffle-dev](https://github.com/truffle-dev)! - Fix empty TUI session list when launching kilo from inside a git submodule. `git worktree list --porcelain` reports the submodule's gitdir (`<repo>/.git/modules/<sub>`) instead of the working tree, so the worktree-family filter dropped every session whose directory was the actual submodule path. Include `Instance.worktree` in the returned set so submodule sessions stay in scope.

## 7.3.18

### Patch Changes

- [#10736](https://github.com/Kilo-Org/kilocode/pull/10736) [`57bc6ee`](https://github.com/Kilo-Org/kilocode/commit/57bc6eea583e22e4c3b8b00ad1c64fed62dc85e8) - Use Kilo session share links when sharing conversations from the CLI.

- [#10737](https://github.com/Kilo-Org/kilocode/pull/10737) [`f574294`](https://github.com/Kilo-Org/kilocode/commit/f5742940ccd06bafd2708e32af30023eef241241) - Support reading text from DOCX files through the read tool.

- [#10740](https://github.com/Kilo-Org/kilocode/pull/10740) [`2081af2`](https://github.com/Kilo-Org/kilocode/commit/2081af2b3344890481cb4bd44260e60a8cccba80) - Support reading XLSX spreadsheets as labelled tabular text

## 7.3.17

### Patch Changes

- [#10721](https://github.com/Kilo-Org/kilocode/pull/10721) [`2efa216`](https://github.com/Kilo-Org/kilocode/commit/2efa216ee5bfffa6e01f51ae5add7c5b9034833c) - Keep Agent Manager turns running while slow snapshot baselines initialize instead of stopping for an interactive question.

- [#10703](https://github.com/Kilo-Org/kilocode/pull/10703) [`eeff6d9`](https://github.com/Kilo-Org/kilocode/commit/eeff6d9df8d378c561c4ca212d650be1dfbd912a) Thanks [@barzhomi](https://github.com/barzhomi)! - Fix LanceDB metadata corruption that caused a full re-index on every VS Code restart

- [#10733](https://github.com/Kilo-Org/kilocode/pull/10733) [`4967c22`](https://github.com/Kilo-Org/kilocode/commit/4967c228611f58bb84c0b762eee88d306ab1b624) - Read Jupyter notebooks as ordered markdown and code cell content instead of raw notebook payloads.

- [#10669](https://github.com/Kilo-Org/kilocode/pull/10669) [`0107a01`](https://github.com/Kilo-Org/kilocode/commit/0107a0163cf73004ee13b0ae5fd46811a273d80a) - Guide Agent Manager orchestration to recall completed session context only when needed.

- [#10668](https://github.com/Kilo-Org/kilocode/pull/10668) [`ef2390d`](https://github.com/Kilo-Org/kilocode/commit/ef2390d7a4ffafc379d1e15db94d3a2cd6dcce9b) - Access semantic indexing without an experimental feature toggle while keeping indexing disabled until enabled globally or for a project.

## 7.3.16

## 7.3.15

## 7.3.14

### Patch Changes

- [#8761](https://github.com/Kilo-Org/kilocode/pull/8761) [`74e01b1`](https://github.com/Kilo-Org/kilocode/commit/74e01b1d485ee77943d2d46f05dce1c7cd2daf82) Thanks [@brendandebeasi](https://github.com/brendandebeasi)! - Fix packaged CLI startup crashes caused by duplicate OpenTUI/Solid renderer instances.

- [#10648](https://github.com/Kilo-Org/kilocode/pull/10648) [`9fbd547`](https://github.com/Kilo-Org/kilocode/commit/9fbd5479b09739b21ca636612a85501f0d0f548f) - Keep the extension responsive while semantic indexing processes large workspaces.

- [#10619](https://github.com/Kilo-Org/kilocode/pull/10619) [`117691e`](https://github.com/Kilo-Org/kilocode/commit/117691e4d6fe48f91223bb7d7e24103c67cde73f) - Use supported hosted model presets for Kilo indexing and clear obsolete model and dimension overrides.

- [#10657](https://github.com/Kilo-Org/kilocode/pull/10657) [`d883ad9`](https://github.com/Kilo-Org/kilocode/commit/d883ad96ab7bd1b31a83d227065ad231a225a4c4) - Keep the extension usable on fresh startup when semantic indexing is enabled globally.

- [#10618](https://github.com/Kilo-Org/kilocode/pull/10618) [`dcfadac`](https://github.com/Kilo-Org/kilocode/commit/dcfadac83ed45a109a402a2f71f4d214347804f1) - Prevent saved global indexing provider changes from temporarily reverting in active workspaces.

- Updated dependencies [[`117691e`](https://github.com/Kilo-Org/kilocode/commit/117691e4d6fe48f91223bb7d7e24103c67cde73f), [`db38888`](https://github.com/Kilo-Org/kilocode/commit/db388889e867021c6bae42cbd03df6b67941b208)]:
  - @kilocode/kilo-indexing@7.3.13
  - @kilocode/sdk@7.3.13
  - @kilocode/kilo-gateway@7.4.0
  - @kilocode/plugin@7.3.13
  - @kilocode/kilo-telemetry@7.3.13

## 7.3.11

### Patch Changes

- [#10485](https://github.com/Kilo-Org/kilocode/pull/10485) [`7025c77`](https://github.com/Kilo-Org/kilocode/commit/7025c779f74b2c68afa05bd2f70ce1123ae9cecc) - Surface failed sub-agent tasks as tool errors so parent sessions can recover.

- [#10443](https://github.com/Kilo-Org/kilocode/pull/10443) [`8e76807`](https://github.com/Kilo-Org/kilocode/commit/8e7680794da86c6d938d6626066157c9cd18adbb) - Support configuring the default task subagent model and reasoning effort while safely inheriting the calling agent model when the override is unavailable.

## 7.3.10

### Patch Changes

- [#10302](https://github.com/Kilo-Org/kilocode/pull/10302) [`8ba138d`](https://github.com/Kilo-Org/kilocode/commit/8ba138def73897d7c19208a067f8a2b4be947fd6) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Export all messages from TUI instead of truncated store

## 7.3.9

### Minor Changes

- [#10500](https://github.com/Kilo-Org/kilocode/pull/10500) [`4ef3717`](https://github.com/Kilo-Org/kilocode/commit/4ef371768a1b8cc2cea895339b46d4a1322a6738) - Support xAI Grok OAuth and device-code login for SuperGrok users.

### Patch Changes

- [#10510](https://github.com/Kilo-Org/kilocode/pull/10510) [`c076058`](https://github.com/Kilo-Org/kilocode/commit/c076058bfcbd4f561abc634f3aa109dee598f396) - Use the fallback logo in old Windows terminal emulators while keeping the Unicode logo available over SSH.

- [#9951](https://github.com/Kilo-Org/kilocode/pull/9951) [`0d12909`](https://github.com/Kilo-Org/kilocode/commit/0d12909a9edb49482365d826d0d91e908d40eb24) - Support optional review focus for `/local-review` and `/local-review-uncommitted`, optional base selection for `/local-review`, and focus both prompts on high-confidence security, performance, business logic, deploy safety, duplication, and dead-code findings.

- [#10510](https://github.com/Kilo-Org/kilocode/pull/10510) [`656572c`](https://github.com/Kilo-Org/kilocode/commit/656572c2cfeff16034769381acfb60f9f85091a1) - Avoid leaving mouse and advanced keyboard modes enabled after exiting the TUI in mintty and MINGW terminals.

## 7.3.8

### Patch Changes

- [#8403](https://github.com/Kilo-Org/kilocode/pull/8403) [`42844e5`](https://github.com/Kilo-Org/kilocode/commit/42844e505475650c16f92251421ad792c6429184) Thanks [@saschabuehrle](https://github.com/saschabuehrle)! - Accept `env` as an alias for `environment` in local MCP server configuration. Configurations using the more common `env` key (matching Docker, npm, and VS Code conventions) are now normalised on load instead of failing strict validation.

- [#10495](https://github.com/Kilo-Org/kilocode/pull/10495) [`ae0fbe8`](https://github.com/Kilo-Org/kilocode/commit/ae0fbe89dc5859fcea3c5d1e459a77eb459a8f71) - Show recent and favorited models in provider-specific model lists.

## 7.3.7

### Patch Changes

- [#10297](https://github.com/Kilo-Org/kilocode/pull/10297) [`74e8604`](https://github.com/Kilo-Org/kilocode/commit/74e860431f3f9fcbfcea764711b8c1487d9a8f8d) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Vertically center TUI dialogs on screen

## 7.3.5

### Patch Changes

- Updated dependencies [[`205e22e`](https://github.com/Kilo-Org/kilocode/commit/205e22ee4672305d3cb2e0c34b607a4950f8f4e8)]:
  - @kilocode/kilo-indexing@7.3.5

## 7.3.3

### Patch Changes

- [#10155](https://github.com/Kilo-Org/kilocode/pull/10155) [`371b7e8`](https://github.com/Kilo-Org/kilocode/commit/371b7e8ae6057f0fefae3982eee6923f2c0a61f0) - Resolve bundled tree-sitter WASM resources from the installed CLI layout so codebase indexing works in packaged CLI and VS Code builds.

## 7.3.2

## 7.3.1

### Patch Changes

- [#10285](https://github.com/Kilo-Org/kilocode/pull/10285) [`d23e162`](https://github.com/Kilo-Org/kilocode/commit/d23e162051f118beb993f84cebad1002d974ad79) - Capture aggregate usage telemetry for experimental Morph-backed codebase search.

- [#10358](https://github.com/Kilo-Org/kilocode/pull/10358) [`413222f`](https://github.com/Kilo-Org/kilocode/commit/413222f0137a29c5cf09666ea3b515032c81f9b8) - Resume interrupted CLI turns automatically after network recovery while giving users 10 seconds to cancel.

- [#10293](https://github.com/Kilo-Org/kilocode/pull/10293) [`af115af`](https://github.com/Kilo-Org/kilocode/commit/af115afe20893f4d24d22a40411ebdbd398781d7) - Harden Mermaid diagram rendering with upstream security fixes.

## 7.3.0

### Patch Changes

- [#10279](https://github.com/Kilo-Org/kilocode/pull/10279) [`a3769d8`](https://github.com/Kilo-Org/kilocode/commit/a3769d83de3e1121c05877f5673dbcb5d3429c6b) - Keep Enhance Prompt focused on rewriting draft prompts instead of answering question-shaped drafts directly.

## 7.2.54

### Minor Changes

- [#10218](https://github.com/Kilo-Org/kilocode/pull/10218) [`4860e65`](https://github.com/Kilo-Org/kilocode/commit/4860e654ca1cc46c4e99acc3f40d4f1302e34944) - Support setting an auto-compaction threshold percentage so long sessions can compact before the context window is full.

### Patch Changes

- [#10136](https://github.com/Kilo-Org/kilocode/pull/10136) [`8af638e`](https://github.com/Kilo-Org/kilocode/commit/8af638e7e20c645b22d96da5e30665e8e9cbf6ad) - Show ChatGPT sign-in again when Codex authentication expires.

- [#8754](https://github.com/Kilo-Org/kilocode/pull/8754) [`e498c02`](https://github.com/Kilo-Org/kilocode/commit/e498c02f7acc5c228bbd45f9e4f294bf5def21ca) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Fix TUI diff rendering when header-like content lines appear inside a unified diff hunk.

- [#10158](https://github.com/Kilo-Org/kilocode/pull/10158) [`d8245a0`](https://github.com/Kilo-Org/kilocode/commit/d8245a0ceb0989b8596c5a5d17fd1095ba9521be) - Fix Mermaid diagrams rendering with empty text inside every shape by restoring the `foreignObject` HTML integration point that DOMPurify dropped in 3.1.7.

- [#10197](https://github.com/Kilo-Org/kilocode/pull/10197) [`1ea86fb`](https://github.com/Kilo-Org/kilocode/commit/1ea86fb6e15cbe486cb0af6f26995d0b1b2745a2) - Prevent Kilo Gateway Responses requests from replaying transient provider item IDs when request storage is disabled.

- Updated dependencies [[`4860e65`](https://github.com/Kilo-Org/kilocode/commit/4860e654ca1cc46c4e99acc3f40d4f1302e34944), [`1af7973`](https://github.com/Kilo-Org/kilocode/commit/1af79731a8ed925f1f69aa536ba90a53b89e8dfb), [`1ea86fb`](https://github.com/Kilo-Org/kilocode/commit/1ea86fb6e15cbe486cb0af6f26995d0b1b2745a2), [`f5dc95b`](https://github.com/Kilo-Org/kilocode/commit/f5dc95b99394c17ad7140bb034bc15a0f9de60b6)]:
  - @kilocode/sdk@7.3.0
  - @kilocode/kilo-gateway@7.3.0
  - @kilocode/plugin@7.2.53
  - @kilocode/kilo-indexing@7.2.53
  - @kilocode/kilo-telemetry@7.2.53

## 7.2.51

### Patch Changes

- [#10121](https://github.com/Kilo-Org/kilocode/pull/10121) [`9963b02`](https://github.com/Kilo-Org/kilocode/commit/9963b0271a78244f773e6192721376618d0a3549) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Auto-approve Task subagent tool permissions when running `kilo run --auto`.

- [#10114](https://github.com/Kilo-Org/kilocode/pull/10114) [`0676243`](https://github.com/Kilo-Org/kilocode/commit/0676243df3afcd97fa7fc40da3c8bf9b092156c3) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Remove `--dangerously-skip-permissions` CLI flag which did nothing

- [#10137](https://github.com/Kilo-Org/kilocode/pull/10137) [`33a233f`](https://github.com/Kilo-Org/kilocode/commit/33a233fd117f23ce967bda7318dc6b3aa3c83e11) - Prevent subagents from spawning nested subagents.

- [#10142](https://github.com/Kilo-Org/kilocode/pull/10142) [`00313bf`](https://github.com/Kilo-Org/kilocode/commit/00313bfcd4326cf24ffda674da3befe493633b20) Thanks [@truffle-dev](https://github.com/truffle-dev)! - Clarify that semantic search returns matching code snippets with paths, line ranges, and relevance scores.

## 7.2.50

## 7.2.49

### Patch Changes

- [#10076](https://github.com/Kilo-Org/kilocode/pull/10076) [`c48b31c`](https://github.com/Kilo-Org/kilocode/commit/c48b31c3ec077ea88549a1f1f025b558a1f8abf6) - Fix garbled diff and additions/deletions counts shown by `apply_patch` when updating a non-UTF-8 file.

- [#10077](https://github.com/Kilo-Org/kilocode/pull/10077) [`1cf0943`](https://github.com/Kilo-Org/kilocode/commit/1cf09437f9d6cf8227f28d6a85a84d4766f26bc0) - Speed up reading large files: the `read` tool now streams UTF-8 content from disk and stops once the line/byte cap is reached, instead of loading the whole file into memory first.

## 7.2.48

### Patch Changes

- [#10051](https://github.com/Kilo-Org/kilocode/pull/10051) [`2d50e1f`](https://github.com/Kilo-Org/kilocode/commit/2d50e1f2dda5533196425b55e5915ee2a49334b6) - Harden git operations against malicious repositories and environment variables by upgrading the underlying git library.

- [#10050](https://github.com/Kilo-Org/kilocode/pull/10050) [`f1ae973`](https://github.com/Kilo-Org/kilocode/commit/f1ae973c537045d7b41766563aaa24b51be1072e) - Suggest local code reviews after more completed changes while still avoiding small edits and repeated suggestions.

- [#10060](https://github.com/Kilo-Org/kilocode/pull/10060) [`0cc0415`](https://github.com/Kilo-Org/kilocode/commit/0cc04158d0cd256ddce306bd330af3c3a328f8be) - Harden markdown rendering against malicious HTML by picking up the latest DOMPurify security fixes.

- Updated dependencies [[`924f034`](https://github.com/Kilo-Org/kilocode/commit/924f034e12f3455f8cb69bb112541f887f4adfe5)]:
  - @kilocode/kilo-indexing@7.2.48

## 7.2.47

### Minor Changes

- [#9851](https://github.com/Kilo-Org/kilocode/pull/9851) [`9de7c98`](https://github.com/Kilo-Org/kilocode/commit/9de7c986e78683015631d14fabd513c3123ff330) - Support Kilo-hosted embeddings as a selectable code indexing provider.

### Patch Changes

- [#10016](https://github.com/Kilo-Org/kilocode/pull/10016) [`d2ae16a`](https://github.com/Kilo-Org/kilocode/commit/d2ae16a9216f0de6e1cb08950f739108515e7998) - Support configuring Azure OpenAI resource names or endpoint URLs from the provider settings flow, and document using the native Azure provider for GPT-5 family deployments.

- [#10014](https://github.com/Kilo-Org/kilocode/pull/10014) [`4b88379`](https://github.com/Kilo-Org/kilocode/commit/4b883792fb8219cf5c4d811ce23b930f6a597ddf) - Improved accuracy of Kilo Gateway cost reporting.

- [#10012](https://github.com/Kilo-Org/kilocode/pull/10012) [`0363006`](https://github.com/Kilo-Org/kilocode/commit/03630064ad865b31cb9e3ed591acd6f07ece4d0c) - Recover compaction when large tool results or media attachments exceed provider payload limits.

- [#9969](https://github.com/Kilo-Org/kilocode/pull/9969) [`eb77fbc`](https://github.com/Kilo-Org/kilocode/commit/eb77fbc13b382eb46c5158165124c6e015449a21) - Prevent an infinite agent loop when a provider ends the response stream without a terminal stop reason.

## 7.2.44

### Minor Changes

- [#9764](https://github.com/Kilo-Org/kilocode/pull/9764) [`9886674`](https://github.com/Kilo-Org/kilocode/commit/98866740afd7f6c2fd06fecda1ffc69c1703974e) - Migrate KiloClaw chat to the new kilo-chat backend. Replaces the single-channel Stream Chat integration with a multi-conversation experience that matches the web UX at app.kilo.ai/claw/kilo-chat: conversation list, reactions, typing indicators, editing, and action approvals. The TUI continues to render a single chat view backed by the user's primary conversation.

- [#9718](https://github.com/Kilo-Org/kilocode/pull/9718) [`dcaccf3`](https://github.com/Kilo-Org/kilocode/commit/dcaccf38658415819b72390255b9f6555e4795e5) - Rate assistant responses with thumbs up/down. Click the thumbs buttons next to the copy button on any assistant message, or press `<leader>=` / `<leader>-` in the terminal UI. Only shown when telemetry is enabled; feedback is sent to Kilo to help improve model and prompt quality.

### Patch Changes

- [#9915](https://github.com/Kilo-Org/kilocode/pull/9915) [`bcb47be`](https://github.com/Kilo-Org/kilocode/commit/bcb47be3b0cf71990fd3ee1ec562a716aefe3571) - Preserve the selected thinking level after compacting a session.

- [#9997](https://github.com/Kilo-Org/kilocode/pull/9997) [`de9f11e`](https://github.com/Kilo-Org/kilocode/commit/de9f11e3990a818ff6d7184f5ea85ee1409a475f) - Fix gpt-5 models failing with `Unsupported parameter: max_tokens` when accessed through custom OpenAI-compatible providers such as LiteLLM.

- [#9993](https://github.com/Kilo-Org/kilocode/pull/9993) [`98f5f65`](https://github.com/Kilo-Org/kilocode/commit/98f5f65c1a8a543687ae5b308805eec1a2c23dca) - Support global and per-project codebase indexing enablement.

- [#9975](https://github.com/Kilo-Org/kilocode/pull/9975) [`c1ea810`](https://github.com/Kilo-Org/kilocode/commit/c1ea8100e13f44a260edf2ac2c027bd69f72deb3) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Honor configured permission overrides in Ask and Plan modes, including persisted always-allow rules.

- [#10006](https://github.com/Kilo-Org/kilocode/pull/10006) [`9e17137`](https://github.com/Kilo-Org/kilocode/commit/9e17137870556c69a141a6e18c63e67919375305) - Recover sessions when providers end a response with an error finish but no error details.

- [#9921](https://github.com/Kilo-Org/kilocode/pull/9921) [`e5e9d0b`](https://github.com/Kilo-Org/kilocode/commit/e5e9d0ba37bd1065aea5a9a83834c6749121e5bd) - Remove custom providers from settings when disconnecting them so they do not reappear after being disabled and re-enabled.

- Updated dependencies [[`9886674`](https://github.com/Kilo-Org/kilocode/commit/98866740afd7f6c2fd06fecda1ffc69c1703974e), [`e5e9d0b`](https://github.com/Kilo-Org/kilocode/commit/e5e9d0ba37bd1065aea5a9a83834c6749121e5bd)]:
  - @kilocode/kilo-gateway@7.3.0
  - @kilocode/sdk@7.3.0
  - @kilocode/kilo-indexing@7.2.43
  - @kilocode/kilo-telemetry@7.2.43
  - @kilocode/plugin@7.2.43

## 7.2.42

### Minor Changes

- [#9909](https://github.com/Kilo-Org/kilocode/pull/9909) [`9ffd047`](https://github.com/Kilo-Org/kilocode/commit/9ffd047962039d6b73d301d5d4e67560cd501c4f) - Detect and preserve UTF-32 (LE and BE) with BOM when reading and editing files. UTF-16 and UTF-32 without a BOM remain unsupported.

### Patch Changes

- [#9887](https://github.com/Kilo-Org/kilocode/pull/9887) [`d9453f0`](https://github.com/Kilo-Org/kilocode/commit/d9453f0da2b063041f6f98235220cde9129e162d) - Fix queued-turn auto-compaction so overflow recovery runs instead of exhausting compaction attempts.

- [#9855](https://github.com/Kilo-Org/kilocode/pull/9855) [`59e8eff`](https://github.com/Kilo-Org/kilocode/commit/59e8effc3df8a03146f5ceddf95f79989b813417) - Respect project-specific semantic indexing decisions instead of enabling indexing globally across workspaces.

- [#9928](https://github.com/Kilo-Org/kilocode/pull/9928) [`520922f`](https://github.com/Kilo-Org/kilocode/commit/520922ff39354c2df72317dee0f70035c52c24c5) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Prevent VS Code empty windows from starting codebase indexing against the home directory.

- [#9843](https://github.com/Kilo-Org/kilocode/pull/9843) [`27d14d4`](https://github.com/Kilo-Org/kilocode/commit/27d14d432c33051e4bdd5863ea14b207758e9234) - Prompt before reading `.env` files even after broad read permissions were previously approved.

- [#9924](https://github.com/Kilo-Org/kilocode/pull/9924) [`914bbdf`](https://github.com/Kilo-Org/kilocode/commit/914bbdfd0575e40554c39c6691e4264a63109953) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Restore Skill tool access for Plan, Ask, Explore, and other non-system agents so skill workflows are available by default.

- [#9907](https://github.com/Kilo-Org/kilocode/pull/9907) [`d9d4dcd`](https://github.com/Kilo-Org/kilocode/commit/d9d4dcd37c6719652252da66b6a1ce27049beb47) - Recover sessions left unable to continue after an assistant turn was created but never started.

## 7.2.39

### Patch Changes

- [#9840](https://github.com/Kilo-Org/kilocode/pull/9840) [`db26be6`](https://github.com/Kilo-Org/kilocode/commit/db26be6b5d3ac77a729ea5242c8330b9146352a7) - Restore the `KILO=1` environment variable so plugins and tooling can distinguish the Kilo CLI from upstream OpenCode.

## 7.2.36

### Patch Changes

- [#9869](https://github.com/Kilo-Org/kilocode/pull/9869) [`d5fd42c`](https://github.com/Kilo-Org/kilocode/commit/d5fd42c3d736329c27de06d52154701f6f4608fb) - Fix question tool being unavailable in code mode

- [#9838](https://github.com/Kilo-Org/kilocode/pull/9838) [`f499257`](https://github.com/Kilo-Org/kilocode/commit/f499257c3287274473db801edba1852dbcdbd92a) - Honor approved external directory read access in Ask and Plan modes.

- [#9778](https://github.com/Kilo-Org/kilocode/pull/9778) [`33476e5`](https://github.com/Kilo-Org/kilocode/commit/33476e50508f39c232731613fd9d74a7aa19e748) - Show an "Initializing snapshot…" line in the chat while the initial snapshot is running on very large repositories, and add an interactive prompt when it stalls. After 10 seconds (configurable via `KILO_SNAPSHOT_TRACK_TIMEOUT_MS`) the prompt asks whether to keep waiting or disable snapshots for the project; choosing to disable writes `"snapshot": false` to `.kilo/kilo.json` so future sessions skip snapshots entirely.

- [#9833](https://github.com/Kilo-Org/kilocode/pull/9833) [`614bca7`](https://github.com/Kilo-Org/kilocode/commit/614bca7cff862ec96e4707a97f43b540210ab699) - Prevent macOS Spotlight from indexing Kilo-generated data directories.

## 7.2.35

### Patch Changes

- [#9820](https://github.com/Kilo-Org/kilocode/pull/9820) [`a858f00`](https://github.com/Kilo-Org/kilocode/commit/a858f001ba8b2de561c69ba8a42d9d3347b1e66f) - Warn when a model hits its output limit before finishing a response.

- [#8910](https://github.com/Kilo-Org/kilocode/pull/8910) [`8472f90`](https://github.com/Kilo-Org/kilocode/commit/8472f9052883d9acf643e0786e3819936c44a61a) Thanks [@eolbrych](https://github.com/eolbrych)! - Restore the Sign in action for MCP servers that require OAuth authentication in VS Code settings.

## 7.2.33

### Minor Changes

- [#9737](https://github.com/Kilo-Org/kilocode/pull/9737) [`d5fb9eb`](https://github.com/Kilo-Org/kilocode/commit/d5fb9eb2265c03127e776c99020b03bb770255a1) - Support starting Agent Manager local sessions and worktree sessions from an experimental agent tool.

### Patch Changes

- [#9746](https://github.com/Kilo-Org/kilocode/pull/9746) [`80535d4`](https://github.com/Kilo-Org/kilocode/commit/80535d4ed6266888988a66ca28706260ee89e533) - Avoid repeated command approval prompts when multiple sessions request the same saved command permission, without widening bash permission matching.

- [#9460](https://github.com/Kilo-Org/kilocode/pull/9460) [`26e4c11`](https://github.com/Kilo-Org/kilocode/commit/26e4c1148f4e7a734bb8e535e02a1a9ad75be584) - Scope the custom commit message prompt to the current project. Setting it in the VS Code settings now writes to the workspace's `kilo.json` so different repositories can have different conventions, instead of silently applying globally. Also fixes the project-level config update endpoint, which previously wrote to a file that wasn't loaded.

- [#9626](https://github.com/Kilo-Org/kilocode/pull/9626) [`5dbf91c`](https://github.com/Kilo-Org/kilocode/commit/5dbf91cc167c16e04bb41e8af68108f8865a18c8) - Honor allowed read-only external-directory access to Kilo config paths without repeated permission prompts.

- [#9745](https://github.com/Kilo-Org/kilocode/pull/9745) [`da3d79a`](https://github.com/Kilo-Org/kilocode/commit/da3d79a6886944b4ad311211e3f67c350958a6ca) - Use a GPT-5.5-specific coding prompt that improves autonomous task handling while keeping older Codex generations on their existing prompt.

- [#9729](https://github.com/Kilo-Org/kilocode/pull/9729) [`1493d65`](https://github.com/Kilo-Org/kilocode/commit/1493d656c9afcafd41a13b45bdf734fb881536df) - Keep Remote status visible in the TUI while remote control is connecting.

- [#9669](https://github.com/Kilo-Org/kilocode/pull/9669) [`0bf14eb`](https://github.com/Kilo-Org/kilocode/commit/0bf14eb2ff5ef59f9dc98342218addc670a87481) - Stop emitting `ai.*` and `gen_ai.*` OpenTelemetry spans from AI SDK calls, and remove the PostHog bridge that forwarded them. Tool/session/indexing telemetry is unchanged.

## 7.2.31

### Patch Changes

- [#9687](https://github.com/Kilo-Org/kilocode/pull/9687) [`9028174`](https://github.com/Kilo-Org/kilocode/commit/9028174cfd5fdd0cf2f3dd87d5ace7cfa780cc4d) - Show compact todo update cards when checking off items in long todo lists.

## 7.2.30

### Patch Changes

- [#9625](https://github.com/Kilo-Org/kilocode/pull/9625) [`1e01ac3`](https://github.com/Kilo-Org/kilocode/commit/1e01ac3ce09070a42c079daf0ff8f07a0e6f7b23) - Respect configured agent models when reopening the CLI or switching projects.

- [#9434](https://github.com/Kilo-Org/kilocode/pull/9434) [`a995b94`](https://github.com/Kilo-Org/kilocode/commit/a995b94d311a4ff8c49437369d4a0a468fc5f74f) - Fix sessions with large image attachments becoming unusable after compaction. When a conversation includes big inline images, the outgoing request can exceed the gateway's body-size limit even after a successful summary. The CLI now trims pre-summary messages for all successful summaries (including manual `/compact`) and strips media attachments from older turns once a summary exists, so follow-up prompts stay under the gateway limit and the session keeps working.

- [#9450](https://github.com/Kilo-Org/kilocode/pull/9450) [`2032fe4`](https://github.com/Kilo-Org/kilocode/commit/2032fe4c4e574aa0664a1ab91e34633ce5b261f9) - Fix a session hang that could occur when multiple Kilo panels showed the same permission prompt, or when a subagent's permission was replied to from the wrong worktree. Replies are now routed to the exact CLI instance that holds the pending permission, and stale/unknown permissions surface a clear error so the UI doesn't leave buttons permanently disabled.

- [#9635](https://github.com/Kilo-Org/kilocode/pull/9635) [`cbe5510`](https://github.com/Kilo-Org/kilocode/commit/cbe55103b10cda881ab39f2932a856f4ea36fce3) - Rename the published Docker image from `ghcr.io/kilo-org/kilo` to `ghcr.io/kilo-org/kilocode` so it lives alongside the active `kilocode` repo instead of the archived `kilo` one.

- [#9628](https://github.com/Kilo-Org/kilocode/pull/9628) [`6130a3e`](https://github.com/Kilo-Org/kilocode/commit/6130a3ea66c6a323710fdc2d325fac87011f6b85) - Show paid Kilo models to signed-out users so selecting one prompts them to log in.

- [#9556](https://github.com/Kilo-Org/kilocode/pull/9556) [`eae081a`](https://github.com/Kilo-Org/kilocode/commit/eae081a0c7404aa8a2516739c3f6725e8c4ff115) - Prevent Ask and Plan modes, including saved or allow-all approvals, from editing files before an explicit implementation step.

- [#9615](https://github.com/Kilo-Org/kilocode/pull/9615) [`0907c6f`](https://github.com/Kilo-Org/kilocode/commit/0907c6f46e2e3d8f7601dcaac9de60dd8c0e02ee) - Keep interactive tools available when semantic indexing fails to load.

- [#9603](https://github.com/Kilo-Org/kilocode/pull/9603) [`4145e48`](https://github.com/Kilo-Org/kilocode/commit/4145e48e82d862178102386cd8a1c874b9415696) - Improve Windows worktree cleanup reliability when file handles are released slowly.

- Updated dependencies [[`28a0eae`](https://github.com/Kilo-Org/kilocode/commit/28a0eae4b0b940482222f6671a6885b575b2ad9c), [`6130a3e`](https://github.com/Kilo-Org/kilocode/commit/6130a3ea66c6a323710fdc2d325fac87011f6b85)]:
  - @kilocode/kilo-indexing@7.1.4
  - @kilocode/kilo-gateway@7.2.27
  - @kilocode/kilo-telemetry@7.2.27

## 7.2.26

### Patch Changes

- [#9549](https://github.com/Kilo-Org/kilocode/pull/9549) [`a5bca01`](https://github.com/Kilo-Org/kilocode/commit/a5bca011a16077d4394f9b5650a387f235cc77b2) - Prefer ChatGPT OAuth credentials over inherited OpenAI environment variables and make ChatGPT sign-in easier to find.

- [#9448](https://github.com/Kilo-Org/kilocode/pull/9448) [`73ab363`](https://github.com/Kilo-Org/kilocode/commit/73ab363f9a1592721d4ce4b92d1a083b7bc8176b) - Fix session cost display missing subagent costs. The TUI footer, sidebar, web context panel, and ACP usage reports now include the cost of every subagent the session spawned, including nested ones.

- [#9484](https://github.com/Kilo-Org/kilocode/pull/9484) [`dbf1135`](https://github.com/Kilo-Org/kilocode/commit/dbf113524ed27e2aaac9afc5441e70339edaa164) - Prompt before agents access files outside the active directory when a workspace boundary resolves to a filesystem root.

## 7.2.25

### Patch Changes

- [#9526](https://github.com/Kilo-Org/kilocode/pull/9526) [`c8113f2`](https://github.com/Kilo-Org/kilocode/commit/c8113f27b190f5c08ce642da57d68646132e1828) - Fix multi-turn DeepSeek reasoning round-tripping on OpenRouter by bumping `@openrouter/ai-sdk-provider` to 2.8.1 in both the CLI and Kilo Gateway packages and letting the SDK handle reasoning details, plus pulling in upstream DeepSeek variant, reasoning-effort, and assistant-reasoning fixes. New DeepSeek conversations are fixed; existing sessions that already stored empty reasoning metadata may still need to be restarted.

- Updated dependencies [[`c8113f2`](https://github.com/Kilo-Org/kilocode/commit/c8113f27b190f5c08ce642da57d68646132e1828)]:
  - @kilocode/kilo-gateway@7.2.25
  - @kilocode/kilo-telemetry@7.2.25

## 7.2.23

### Minor Changes

- [#9418](https://github.com/Kilo-Org/kilocode/pull/9418) [`12c2d86`](https://github.com/Kilo-Org/kilocode/commit/12c2d86c84ecfce118ffb5b4db7ed4155bbca8fc) - Show the open GitHub PR for the current branch in the session sidebar.

### Patch Changes

- [#9470](https://github.com/Kilo-Org/kilocode/pull/9470) [`7fe4508`](https://github.com/Kilo-Org/kilocode/commit/7fe4508eecf7e7da8336f75c0884d1b310af6c6e) - Fix multi-turn tool calls with DeepSeek thinking mode by preserving empty `reasoning_content` in the interleaved transform.

## 7.2.22

### Patch Changes

- [#9455](https://github.com/Kilo-Org/kilocode/pull/9455) [`567ca0d`](https://github.com/Kilo-Org/kilocode/commit/567ca0d34178a6a896aa58c10cc946565c116d4e) - Fix a 1-2 second startup delay before home content (agents, news, tips) appears in the TUI.

- [#9425](https://github.com/Kilo-Org/kilocode/pull/9425) [`6ee160f`](https://github.com/Kilo-Org/kilocode/commit/6ee160f89c10293d635990798779988d34b092b4) - Preserve typed text in the main prompt when a blocking question, suggestion, permission, or network overlay is shown and then dismissed.

## 7.2.21

### Minor Changes

- [#8587](https://github.com/Kilo-Org/kilocode/pull/8587) [`010a946`](https://github.com/Kilo-Org/kilocode/commit/010a94698e449bdd9270f44e53aa209dd4c7a248) - The agent now detects and preserves the original text encoding of files when reading and editing them, so non-UTF-8 files are displayed correctly to the model and written back in their original encoding. New files are still created as UTF-8 without BOM — detection only applies when overwriting or editing an existing file.

  Supported: UTF-8 (with or without BOM), UTF-16 with BOM, and common legacy Latin and CJK encodings (Shift_JIS, EUC-JP, GB2312, Big5, EUC-KR, Windows-1251, KOI8-R, ISO-8859, and others).

  Not supported: UTF-16 without BOM, UTF-32.

### Patch Changes

- [#9298](https://github.com/Kilo-Org/kilocode/pull/9298) [`8d06a08`](https://github.com/Kilo-Org/kilocode/commit/8d06a083bce0d87ad55adeb57b043cc5607979eb) - CLI suggestions now render inline in the conversation at the position of the suggest tool call, instead of as a separate bar above the prompt input. The inline bar renders as a single full-width row with a subtle background and clickable action buttons, matching the VS Code extension. Dismissal happens automatically when you send a new prompt. Blocking suggestions still use the above-prompt overlay.

- [#9298](https://github.com/Kilo-Org/kilocode/pull/9298) [`2ba203b`](https://github.com/Kilo-Org/kilocode/commit/2ba203b6bdad1b759b26501e74d278d13f77f69b) - CLI suggestions now render above an active input prompt. You can keep typing and submit a new message while a suggestion is on screen — sending a message auto-dismisses the pending suggestion, matching the VS Code extension behavior. The redundant "Dismiss" row has been removed; click an option to accept, or press Esc to dismiss.

- [#9344](https://github.com/Kilo-Org/kilocode/pull/9344) [`c032fc2`](https://github.com/Kilo-Org/kilocode/commit/c032fc2021c55589ff7aee747d8f8a871e77bc56) - Fix an infinite "busy" loop that could occur when a model kept reporting context overflow after every compaction. Each turn now caps compactions at three attempts and closes the turn with a visible context-overflow error instead of silently looping forever.

- [#9408](https://github.com/Kilo-Org/kilocode/pull/9408) [`c214d63`](https://github.com/Kilo-Org/kilocode/commit/c214d63afb426df0b3499b5240fe5ce525561497) - Narrow when the CLI suggests a local code review so it no longer surfaces after PR-comment replies, reactive fixes (CI/lint failures, reported issues), trivial edits, non-implementation work (research, commits, docs), or review-adjacent turns.

## 7.2.19

### Patch Changes

- Updated dependencies [[`3b73cf4`](https://github.com/Kilo-Org/kilocode/commit/3b73cf474ee7bd81ac1cb4a0153906059f3a2d3a)]:
  - @kilocode/kilo-gateway@7.2.19
  - @kilocode/kilo-telemetry@7.2.19

## 7.2.18

### Patch Changes

- [#9300](https://github.com/Kilo-Org/kilocode/pull/9300) [`0d0dabe`](https://github.com/Kilo-Org/kilocode/commit/0d0dabe59838e48ec8633227c508531e2296dde9) - Fix the "Start new session" button on the plan follow-up prompt not switching the VS Code Agent Manager to the new session when handover generation is slow. The new session now opens immediately, shows the plan text right away, stays visibly busy while the handover summary is being prepared, and appends that summary once it finishes generating.

## 7.2.17

### Patch Changes

- [#9276](https://github.com/Kilo-Org/kilocode/pull/9276) [`e6310c5`](https://github.com/Kilo-Org/kilocode/commit/e6310c5292b43745c3c6e75a08bb584f7f1fd6d5) - Add Alibaba to `kiloProviderOptions` so thinking is enabled correctly when routing through the Kilo gateway with `ai_sdk_provider: "alibaba"`.

- [#9120](https://github.com/Kilo-Org/kilocode/pull/9120) [`d40fc1c`](https://github.com/Kilo-Org/kilocode/commit/d40fc1c71cde67568c37f30a9653ec1ac2a84131) - Make the `description` parameter of the bash tool optional.

- [#9239](https://github.com/Kilo-Org/kilocode/pull/9239) [`2b17a7b`](https://github.com/Kilo-Org/kilocode/commit/2b17a7b4e80bb2bd30bd95d047c31ad17dd339b6) - Fix custom provider model and variant deletions being silently reverted on save. Removing a model or reasoning variant from a custom provider now actually removes it from your config.

- [#9193](https://github.com/Kilo-Org/kilocode/pull/9193) [`f025e34`](https://github.com/Kilo-Org/kilocode/commit/f025e34b6a91d3e5bd6e5b174105a77ea6d87f6d) - Clarify suggest tool guidance so the assistant writes its final summary before offering a local review.

- [#9164](https://github.com/Kilo-Org/kilocode/pull/9164) [`448dba8`](https://github.com/Kilo-Org/kilocode/commit/448dba8ca595ff95220ab660cbc93ca40b90a19b) - Update `@ai-sdk/anthropic` to 3.0.71, adding `xhigh` effort for Opus 4.7 adaptive thinking (3.0.70) and fixing fine-grained tool streaming beta header for Opus 4.7 (3.0.71)

- [#9170](https://github.com/Kilo-Org/kilocode/pull/9170) [`297b988`](https://github.com/Kilo-Org/kilocode/commit/297b988a211933e106bf2864518e3542587d3f0b) - Update `@ai-sdk/amazon-bedrock` to 4.0.96 and `@ai-sdk/google-vertex` to 4.0.112, both of which include Opus 4.7 support with `xhigh` adaptive thinking effort

- Updated dependencies [[`8b90eec`](https://github.com/Kilo-Org/kilocode/commit/8b90eec6d0852305ae4379088b1003c1d4e74e6a), [`448dba8`](https://github.com/Kilo-Org/kilocode/commit/448dba8ca595ff95220ab660cbc93ca40b90a19b)]:
  - @kilocode/kilo-gateway@7.3.0
  - @kilocode/kilo-telemetry@7.2.15

## 7.2.14

### Patch Changes

- [#9118](https://github.com/Kilo-Org/kilocode/pull/9118) [`343455b`](https://github.com/Kilo-Org/kilocode/commit/343455b87895a0551760b5710b1ffe58fae21efd) - Respect per-agent model selections when an agent has a `model` configured in `kilo.jsonc`. Switching the model for such an agent now sticks across agent switches and CLI restarts. To pick up a newly edited agent default, re-select the model once (or clear `~/.local/share/kilo/storage/model.json`).

- [#9067](https://github.com/Kilo-Org/kilocode/pull/9067) [`959a8b4`](https://github.com/Kilo-Org/kilocode/commit/959a8b498de6efd28756683162296dd40eb9b454) - Fix "assistant prefill" errors when a user queues a prompt while the previous turn is still streaming. The queued message no longer lands in the middle of the prior turn's history, so the next request always ends with the user prompt.

- [#9023](https://github.com/Kilo-Org/kilocode/pull/9023) [`5301258`](https://github.com/Kilo-Org/kilocode/commit/530125828e891d3c50fe8d783201b65e3c4db8e4) - Support mentioning folders in the prompt with @ references, including top-level folder file contents.

## 7.2.12

### Patch Changes

- [#9068](https://github.com/Kilo-Org/kilocode/pull/9068) [`e65c2d9`](https://github.com/Kilo-Org/kilocode/commit/e65c2d99c0d234d3dc1dff2e75e58e22bea8ce7f) Thanks [@kilo-code-bot](https://github.com/apps/kilo-code-bot)! - Hide Kilo Gateway models that do not support tool calling from the model list.

- [#9069](https://github.com/Kilo-Org/kilocode/pull/9069) [`e60c326`](https://github.com/Kilo-Org/kilocode/commit/e60c3263191c5746bea6bd93cd291c28f5d1ab0f) Thanks [@kilo-code-bot](https://github.com/apps/kilo-code-bot)! - Support adaptive reasoning for Claude Opus 4.7 and expose the `xhigh` effort level for adaptive Anthropic models

- Updated dependencies [[`e65c2d9`](https://github.com/Kilo-Org/kilocode/commit/e65c2d99c0d234d3dc1dff2e75e58e22bea8ce7f)]:
  - @kilocode/kilo-gateway@7.2.12
  - @kilocode/kilo-telemetry@7.2.12

## 7.2.11

### Patch Changes

- [#8898](https://github.com/Kilo-Org/kilocode/pull/8898) [`4a69a3e`](https://github.com/Kilo-Org/kilocode/commit/4a69a3e0d11a041827c1c68e1a47f84ed0f4c893) - Fixed default model falling back to the free model after login or org switch by invalidating cached provider state when auth changes.

- [#8996](https://github.com/Kilo-Org/kilocode/pull/8996) [`58ff01a`](https://github.com/Kilo-Org/kilocode/commit/58ff01a2bcac172ae93e4213046a3e9c6c353f59) Thanks [@kilo-code-bot](https://github.com/apps/kilo-code-bot)! - Include pnpm-lock.yaml and yarn.lock in the .kilo/.gitignore so lockfiles from alternative package managers don't appear as untracked files

- [`4937759`](https://github.com/Kilo-Org/kilocode/commit/4937759bf46737a9300d4effedd627676ab4ca68) - Merged upstream opencode changes from v1.3.10:
  - Subagent tool calls stay clickable while pending
  - Improved storage migration reliability
  - Better muted text contrast in Catppuccin themes

- [`4937759`](https://github.com/Kilo-Org/kilocode/commit/4937759bf46737a9300d4effedd627676ab4ca68) - Merged upstream opencode changes from v1.3.6:
  - Fixed token usage double-counting for Anthropic and Amazon Bedrock providers
  - Fixed variant dialog search filtering

- [`4937759`](https://github.com/Kilo-Org/kilocode/commit/4937759bf46737a9300d4effedd627676ab4ca68) - Merged upstream opencode changes from v1.3.7:
  - Added first-class PowerShell support on Windows
  - Plugin installs now preserve JSONC comments in configuration files
  - Improved variant modal behavior to be less intrusive

- [#9047](https://github.com/Kilo-Org/kilocode/pull/9047) [`bea8878`](https://github.com/Kilo-Org/kilocode/commit/bea88788f4530f57d210b98cd7205168cd8f9ae9) - Continue queued follow-up prompts after the active session turn finishes.

- Updated dependencies [[`4d2f553`](https://github.com/Kilo-Org/kilocode/commit/4d2f55343b7403625c60de09460d01ab8ae268f7)]:
  - @kilocode/kilo-gateway@7.2.11
  - @kilocode/kilo-telemetry@7.2.11
