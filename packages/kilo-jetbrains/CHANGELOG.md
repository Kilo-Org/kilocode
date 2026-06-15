# Changelog

## 7.4.0

### Minor Changes

- [#11165](https://github.com/Kilo-Org/kilocode/pull/11165) [`bf67155`](https://github.com/Kilo-Org/kilocode/commit/bf6715594bae4a1160abb7cfdfdedaba4b8358ec) - Enhance draft prompts from the JetBrains chat composer using the configured small model.

## 7.3.42

### Patch Changes

- [#11015](https://github.com/Kilo-Org/kilocode/pull/11015) [`c90846a`](https://github.com/Kilo-Org/kilocode/commit/c90846a98938d3cdd666c46294ed4bb4871f7fcd) - Fix JetBrains session scrolling so mouse wheel and keyboard scrolling no longer snap back or bounce near the transcript bottom.

- [#11015](https://github.com/Kilo-Org/kilocode/pull/11015) [`d505677`](https://github.com/Kilo-Org/kilocode/commit/d505677d88816cf528b64392e23b7ccdddf98a4a) - Prevent the JetBrains session scrollbar from covering transcript content.

- [#11015](https://github.com/Kilo-Org/kilocode/pull/11015) [`5736a39`](https://github.com/Kilo-Org/kilocode/commit/5736a394597f250f64cf8c684d2426b56ca273ce) - Render glob search results in the JetBrains chat as collapsible tool output with separate directory and pattern rows.

- [#11015](https://github.com/Kilo-Org/kilocode/pull/11015) [`d1fa450`](https://github.com/Kilo-Org/kilocode/commit/d1fa4506c8b8e65b21cd08e0c6600598366aed0f) - Use matching VS Code-style icons for JetBrains session views.

- [#11015](https://github.com/Kilo-Org/kilocode/pull/11015) [`952241e`](https://github.com/Kilo-Org/kilocode/commit/952241ee07eebd22717bdf54ce07b3a6c66228af) - Refine JetBrains session card borders so prompt and question surfaces use brighter outlines while reasoning and tool cards use softer default borders.

- [#11015](https://github.com/Kilo-Org/kilocode/pull/11015) [`b9bff3b`](https://github.com/Kilo-Org/kilocode/commit/b9bff3b69cf27fc7e0d88d411eaa368616fc32d6) - Reset stale hover styling when moving between JetBrains session cards and draw card outlines only while expanded.

- [#11015](https://github.com/Kilo-Org/kilocode/pull/11015) [`5736a39`](https://github.com/Kilo-Org/kilocode/commit/5736a394597f250f64cf8c684d2426b56ca273ce) - Render grep searches in the JetBrains chat with a dedicated search header that shows stacked, clipped targets.

- [#11015](https://github.com/Kilo-Org/kilocode/pull/11015) [`01f2886`](https://github.com/Kilo-Org/kilocode/commit/01f28861900d4794d6329821f0c9f5c9efdedae3) - Improve mouse wheel scrolling speed in the JetBrains session view.

## 7.3.29

### Patch Changes

## [Unreleased]

## [7.0.1-rc.8] - 2026-06-09

### Added

- Display search results and tool output in clearer, more readable JetBrains session cards.

### Fixed

- Improve session transcript scrolling so streaming updates, expanded cards, reasoning blocks, and mouse wheel scrolling preserve the user's position more reliably.
- Make session transcripts easier to scan with tighter spacing, aligned icons, cleaner card outlines, relative search paths, and less visual noise.
- Keep completed reasoning blocks expanded after a response finishes.
- Improve session stability during long-running or cancelled prompts.
- Restore automatic session titles, project skill discovery, and subagent isolation in forked sessions.
- Restore imported cloud session diffs.
- Compact sessions before the configured context limit is exceeded.

### Changed

- Update the bundled Kilo CLI runtime with the latest fixes used by the JetBrains plugin.

## [7.0.1-rc.7] - 2026-06-04

### Fixed

- Fixed JetBrains release notes rendering so notes from multiple releases display correctly.

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
