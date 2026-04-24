# @kilocode/cli

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
