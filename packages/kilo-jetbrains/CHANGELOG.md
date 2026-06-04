# Changelog

## 7.3.29

### Patch Changes

- [#9976](https://github.com/Kilo-Org/kilocode/pull/9976) [`ae6f3c0`](https://github.com/Kilo-Org/kilocode/commit/ae6f3c0e06e450a227ffbd024a52b689b5749d16) - Fix session transcript colors after switching JetBrains IDE themes.

- [#9976](https://github.com/Kilo-Org/kilocode/pull/9976) [`8c06a3b`](https://github.com/Kilo-Org/kilocode/commit/8c06a3b7840960798f1c4f4792b8eed1d366c3c4) - Improve JetBrains session UI stability and responsiveness during streaming updates and collapsed transcript rendering.

- [#9976](https://github.com/Kilo-Org/kilocode/pull/9976) [`87b0cf1`](https://github.com/Kilo-Org/kilocode/commit/87b0cf15ddfe29503fa0a4d72067bce050a1c432) - Improve JetBrains session timeline colors to follow semantic theme keys.

## [Unreleased]

## [7.0.1-rc.6] - 2026-06-03

### Fixed

- Model picker now highlights models that can be used for training.

## [7.0.1-rc.5] - 2026-06-03

### Added

- Added Feedback & Support entry points to the empty session screen
- Model and configuration settings, including config file shortcuts and separate CLI restart and reinstall actions.

### Fixed

- Prevented stale backend events from affecting sessions after a restart.
- Improved chat code blocks and made long or streaming session transcripts faster and more stable.

## [7.0.1-rc.4] - 2026-05-29

### Added

- Initial JetBrains plugin release with a native Kilo Code tool window.
- Chat sessions with streamed responses, tool output, reasoning, markdown, todos, and plan follow-ups.
- Native mode/model selection, account sign-in, permission prompts, and question flows.
- Local and cloud session history with search, reopen, rename/delete local sessions, and repository filtering.
- Migration wizard for legacy JetBrains plugin settings and chat history.
- Bundled Kilo CLI runtime for macOS, Linux, and Windows.
