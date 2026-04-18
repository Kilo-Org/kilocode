# @kilocode/cli

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
