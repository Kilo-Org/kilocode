# @kilocode/cli

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
