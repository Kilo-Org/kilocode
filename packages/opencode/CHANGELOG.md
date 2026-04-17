# @kilocode/cli

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
