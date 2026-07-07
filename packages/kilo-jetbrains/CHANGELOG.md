# Changelog

## 7.4.0

### Minor Changes

- [#11870](https://github.com/Kilo-Org/kilocode/pull/11870) [`ad746f2`](https://github.com/Kilo-Org/kilocode/commit/ad746f22af3f4fd24c26a36f4eaf803fff1173b3) - Show expandable model details in the JetBrains model picker.

### Patch Changes

- [#11871](https://github.com/Kilo-Org/kilocode/pull/11871) [`73bdb92`](https://github.com/Kilo-Org/kilocode/commit/73bdb923c75ccadf56759e1311468d6cfada6de7) - Render JetBrains todo checklists with consistent text weight and higher-contrast checkboxes.

- [#11850](https://github.com/Kilo-Org/kilocode/pull/11850) [`d4db9c9`](https://github.com/Kilo-Org/kilocode/commit/d4db9c9be29102eca82668ded35db4348efb43da) - Show resolved JetBrains config file paths, float connection status above the prompt, and offer retry, restart, and reinstall recovery actions from connection errors. JetBrains now opens the same global config directory used by the CLI; macOS and Windows users who previously created global config from JetBrains may need to move files from the old platform-specific location to `~/.config/kilo`.

- [#11871](https://github.com/Kilo-Org/kilocode/pull/11871) [`07f1e27`](https://github.com/Kilo-Org/kilocode/commit/07f1e27b09dc484dd97c37da1c54b39f5ec2b31a) - Match JetBrains inline code and file-reference link styling with VS Code, and render quotes with muted theme-aware styling.

- [#11871](https://github.com/Kilo-Org/kilocode/pull/11871) [`521a8ff`](https://github.com/Kilo-Org/kilocode/commit/521a8ff310ed4273bc4127a9e145c0693a637de5) - Show JetBrains missing-file warnings without animation and always show shell command header popups for collapsed shell runs.

- [#11871](https://github.com/Kilo-Org/kilocode/pull/11871) [`95b1d54`](https://github.com/Kilo-Org/kilocode/commit/95b1d54b57f8ff46f239f2b09726dabd6c448af0) - Open JetBrains session file links in the active workspace and hide sibling worktree matches.

- [#11871](https://github.com/Kilo-Org/kilocode/pull/11871) [`06231f9`](https://github.com/Kilo-Org/kilocode/commit/06231f97a35afdfef6ea5d697104b6c2c8df8644) - Clear stale session link hover styling when the transcript is scrolled.

- [#11871](https://github.com/Kilo-Org/kilocode/pull/11871) [`112e7d7`](https://github.com/Kilo-Org/kilocode/commit/112e7d7beea1179dfaf0d0826fdad3daf99a784b) - Keep JetBrains tool headers to a single clipped line.

- [#11813](https://github.com/Kilo-Org/kilocode/pull/11813) [`a824c4c`](https://github.com/Kilo-Org/kilocode/commit/a824c4cba9604e85f857215ef772efec13af2278) - Keep JetBrains sessions scoped to the correct worktree when multiple IntelliJ windows are open.

- [#11553](https://github.com/Kilo-Org/kilocode/pull/11553) [`3847122`](https://github.com/Kilo-Org/kilocode/commit/3847122555cf9d8ec723ec9d62753b0e9c72ccbc) - Improve JetBrains agent, MCP, provider, and model settings so changes are staged until Apply, persist through the CLI, reload accurately, and hide unsupported removal actions.

## 7.4.0

### Minor Changes

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`1a812ea`](https://github.com/Kilo-Org/kilocode/commit/1a812ea5a0efea2647b1676c907d9a08afab9be7) - Add `/` slash commands and `@` file/git-changes mentions to the JetBrains chat prompt with native completion.

### Patch Changes

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`3dc31d9`](https://github.com/Kilo-Org/kilocode/commit/3dc31d9fd10a622fde0a073e3df4720782c6afea) - Highlight rendered prompt file mentions and open them on click.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`c746eea`](https://github.com/Kilo-Org/kilocode/commit/c746eea1ee446a43b59929525ba93862c0065711) - Show JetBrains file mention suggestions immediately for empty `@` mentions and keep the completion popup stable while typing quickly.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`c23c3e3`](https://github.com/Kilo-Org/kilocode/commit/c23c3e300d410f4d7aac57bb9cbcbe5ce72e67b8) - Hide raw file contents from mentioned files in JetBrains chat messages.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`cfb7006`](https://github.com/Kilo-Org/kilocode/commit/cfb7006e880ae8ae2ad6c3d1bb70eb01e96d0bf4) - Fix @git-changes mentions causing JetBrains chat sessions to fail.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`e5d23fb`](https://github.com/Kilo-Org/kilocode/commit/e5d23fbb649f8326f51e80f15948d9b9e22559a6) - Show file type icons and keep predefined mentions first in JetBrains mention completions.

- [#11805](https://github.com/Kilo-Org/kilocode/pull/11805) [`a303013`](https://github.com/Kilo-Org/kilocode/commit/a3030136e9f54ba5d194ecfdf8e2ab52a57c34a9) Thanks [@johnnyeric](https://github.com/johnnyeric)! - Show Kilo Pass usage, bonus credits, renewal date, and top-up actions in the JetBrains user profile.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`5647086`](https://github.com/Kilo-Org/kilocode/commit/5647086297592f6271663709b11a86942c99a9fc) - Show a concise single-line hint in the JetBrains prompt placeholder.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`dd8b43e`](https://github.com/Kilo-Org/kilocode/commit/dd8b43ef63439638675ac248f93bab629a9e3a34) - Fix prompt undo/redo, clean mid-token mention completion, and show unresolved file mentions in the JetBrains chat prompt.

- [#11802](https://github.com/Kilo-Org/kilocode/pull/11802) [`971a418`](https://github.com/Kilo-Org/kilocode/commit/971a4184399769a321638bc8123496337f21e5ad) - Recover the JetBrains backend when startup or restart loading is interrupted by stale connection failures.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`d54e6b3`](https://github.com/Kilo-Org/kilocode/commit/d54e6b33d0bb7e58f3392d68b5401baa3d2ac2eb) - Attach hand-typed prompt file mentions when sending immediately.

- [#11705](https://github.com/Kilo-Org/kilocode/pull/11705) [`0210702`](https://github.com/Kilo-Org/kilocode/commit/02107028f45c924fd2f61e65e21190b79371da47) - Improve JetBrains session error logs so nested CLI error messages are visible.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`48f2a5f`](https://github.com/Kilo-Org/kilocode/commit/48f2a5f7c8263042cb4a455f0d75f77d35704b9f) - Restore prompt focus after returning from session history in JetBrains.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`a326191`](https://github.com/Kilo-Org/kilocode/commit/a32619109a79e2426137aa1a00c0fa062b565c1d) - Support VS Code slash-command aliases in the JetBrains prompt.

- [#11796](https://github.com/Kilo-Org/kilocode/pull/11796) [`8c37da0`](https://github.com/Kilo-Org/kilocode/commit/8c37da02dadec099fc7a85774facc512091ec539) - Reconnect the JetBrains plugin when its event stream stalls during startup.

- [#11327](https://github.com/Kilo-Org/kilocode/pull/11327) [`0c2a7c1`](https://github.com/Kilo-Org/kilocode/commit/0c2a7c1c5bd9c41a4d77df4690241daefaca6ef5) - Keep JetBrains prompt mention suggestions stable while typing fuzzy file matches.

## 7.3.47

### Patch Changes

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`ef7aa7f`](https://github.com/Kilo-Org/kilocode/commit/ef7aa7fdf854f8a50681b56cb56377fa7763b18d) - Fix JetBrains provider settings after OAuth/connect actions by waiting through transient backend reloads and allowing longer OAuth exchanges.

- [#11095](https://github.com/Kilo-Org/kilocode/pull/11095) [`9eddaf1`](https://github.com/Kilo-Org/kilocode/commit/9eddaf17126a63822307e9a52d9a32794eca5176) - Highlight shell tool commands in JetBrains chat transcripts.

- [#11095](https://github.com/Kilo-Org/kilocode/pull/11095) [`5058050`](https://github.com/Kilo-Org/kilocode/commit/50580501679ea0900c2102c0509575e89f15a48e) - Improve markdown readability in JetBrains chat transcripts.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`52dfa54`](https://github.com/Kilo-Org/kilocode/commit/52dfa5453ed6080270f9e07cf6e9cafd8df75cd7) - Hide generated read-tool payload lines from JetBrains prompt bubbles while keeping attachments and assistant tool output visible.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`9f8f698`](https://github.com/Kilo-Org/kilocode/commit/9f8f698e38f8317b0f19d1f7406b0d6cc9777ad9) - Show JetBrains prompt attachments in one horizontal scrolling row in session history.

- [#11324](https://github.com/Kilo-Org/kilocode/pull/11324) [`bc7f9b0`](https://github.com/Kilo-Org/kilocode/commit/bc7f9b05e8ca61ebf59d5a069923eef59c900a15) - Show a hover copy button for JetBrains session code and tool output blocks.

- [#11324](https://github.com/Kilo-Org/kilocode/pull/11324) [`358135f`](https://github.com/Kilo-Org/kilocode/commit/358135f69ef6a4985cdd7aab0f1a2a8a0b631c27) - Add copy buttons below JetBrains session prompts and assistant responses.

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`db96e31`](https://github.com/Kilo-Org/kilocode/commit/db96e31e655d77ef54ade03c32688218ca2e0e58) - Show provider names on JetBrains model picker buttons for non-Kilo Gateway models.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`49339a2`](https://github.com/Kilo-Org/kilocode/commit/49339a2583f6c51db9d1bfdc3f37ee5a4185b8a9) - Support pasting files and images into JetBrains chat prompts as attachments.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`9f8f698`](https://github.com/Kilo-Org/kilocode/commit/9f8f698e38f8317b0f19d1f7406b0d6cc9777ad9) - Show JetBrains prompt attachments inside the prompt bubble with previews and open embedded attachments in editor tabs.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`a8b127e`](https://github.com/Kilo-Org/kilocode/commit/a8b127e0ca8a7f29a11d03e548e78d084ccc3aa6) - Support sending file and image attachments from the JetBrains chat prompt.

- [#11275](https://github.com/Kilo-Org/kilocode/pull/11275) [`3c319a5`](https://github.com/Kilo-Org/kilocode/commit/3c319a59a24a7fbf4a1d65eb88d1572ec178694b) - Limit JetBrains prompt input growth to the session while preserving scrolling for long prompts.

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`b6bbb83`](https://github.com/Kilo-Org/kilocode/commit/b6bbb839e613a82e65ff445498e128a90851f8a5) - Show Connect for available JetBrains providers without explicit auth metadata, keep only actually configured providers disconnectable, and reduce provider settings diagnostics to debug logs.

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`b0183f9`](https://github.com/Kilo-Org/kilocode/commit/b0183f984611df1b09145aa9716e948ee6bb4780) - Prefer remote-safe provider OAuth methods in JetBrains and show device-code authorization details when available.

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`d8b6efd`](https://github.com/Kilo-Org/kilocode/commit/d8b6efd58c0ee66b1f71e484282993aad27fc08e) - Show cancellable OAuth progress in JetBrains provider settings and prevent starting another provider action while one is running.

- [#11278](https://github.com/Kilo-Org/kilocode/pull/11278) [`62e42c1`](https://github.com/Kilo-Org/kilocode/commit/62e42c1efbeecd243c473e3cdde8d8a6ac55efc5) - Stop Kilo backend processes and clear JetBrains UI resources during restartless plugin unloads.

- [#11324](https://github.com/Kilo-Org/kilocode/pull/11324) [`b4864eb`](https://github.com/Kilo-Org/kilocode/commit/b4864ebd43f211fe3f594edb29798f2f5d48b599) - Fix copying selected text from JetBrains session views.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`793cf93`](https://github.com/Kilo-Org/kilocode/commit/793cf934b72e7f9d71be3f23af058d88be67a9d3) - Support dropping files anywhere in a JetBrains chat session to add them to the prompt.

- [#11095](https://github.com/Kilo-Org/kilocode/pull/11095) [`bb31723`](https://github.com/Kilo-Org/kilocode/commit/bb31723e7353c0649b9854812f9f803e04d92156) - Polish session header controls and align session view icons.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`709a53c`](https://github.com/Kilo-Org/kilocode/commit/709a53cda17da96a74cbd5a8bb88a9c6a78bd28e) - Open embedded JetBrains message attachments in frontend-managed Kilo editor tabs with loading and connection retry states.

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`ad3be6c`](https://github.com/Kilo-Org/kilocode/commit/ad3be6cae999b440277fd8c660ba1b5eead07020) - Organize JetBrains provider settings into connected, popular, and all-provider sections, hide custom-provider creation, and prevent Kilo Gateway disconnects from provider settings.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`a8b127e`](https://github.com/Kilo-Org/kilocode/commit/a8b127e0ca8a7f29a11d03e548e78d084ccc3aa6) - Render file attachments as attachment cards in JetBrains prompts and session history.

- [#11095](https://github.com/Kilo-Org/kilocode/pull/11095) [`a73ee53`](https://github.com/Kilo-Org/kilocode/commit/a73ee5329cf4455d33d8c8fd363ccf83b46a3cdb) - Render JetBrains shell tool output with markdown code blocks.

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`1c7d5ca`](https://github.com/Kilo-Org/kilocode/commit/1c7d5ca7d373770e8d731177e0b851253d9c7d57) - Restore popular provider suggestions in JetBrains provider settings when provider metadata is unavailable.

- [#11221](https://github.com/Kilo-Org/kilocode/pull/11221) [`987da27`](https://github.com/Kilo-Org/kilocode/commit/987da2728731e1da1c974996b5bcddafe745cea7) - Show shared provider descriptions and provider icons in JetBrains and VS Code provider settings.

- [#11077](https://github.com/Kilo-Org/kilocode/pull/11077) [`2f9c6ec`](https://github.com/Kilo-Org/kilocode/commit/2f9c6ecdd00c49b9c53a8e72bf8971cabf51821a) - Open embedded transcript attachments in stable Kilo editor tabs.

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

## [7.0.2-rc.2] - 2026-07-07

### Added
- Show compact previews for collapsed reasoning blocks so long assistant reasoning stays readable without taking over the transcript.
- Add clearer Kilo Core runtime information and diagnostics for release download failures.

### Fixed
- Resolve the CLI executable using the user's shell environment so custom PATH setups work when sessions start from JetBrains.
- Keep retry and offline status visible in the session footer while preserving transcript context.
- Prevent oversized header popups by capping preview content.

### Changed
- Download the required Kilo Core release at runtime and prune stale cached runtime binaries automatically.
- Polish JetBrains chat spacing, prompt input behavior, question/todo layout, history scrolling, code block padding, and session background colors.

## [7.0.2-rc.1] - 2026-07-07

### Added
- Download the pinned Kilo Core release at runtime instead of bundling every CLI binary in the JetBrains plugin, keeping the Marketplace package smaller while still verifying downloaded artifacts.

## [7.0.1] - 2026-07-06

### Added
- Launch the first public Kilo JetBrains release with native JetBrains sessions and remote development support.

## [7.0.1-rc.15] - 2026-07-06

### Fixed

- Improve transcript rendering, prompt focus styling, settings clicks, and prompt picker interactions.

## [7.0.1-rc.14] - 2026-07-02

### Added

- Add Agent Behavior settings
- Show richer model picker details, including routed model information and clearer model badges.
- Show Kilo Pass usage, bonus credits, renewal dates, and top-up actions in the JetBrains user profile.

### Fixed

- Recover backend startup more reliably when event streams stall, reconnect, or are interrupted by stale failures.
- Resolve workspaces by project ID to avoid cross-project session confusion.
- Improve CLI recovery, config paths, and `.kilo` config directory handling.

## [7.0.1-rc.13] - 2026-06-23

### Added

- Add slash command and file mention completion in the prompt.
- Add support for clickable and explainable `@file` mentions in the prompt.

### Fixed

- Fix prompt undo/redo behavior and restore prompt focus after history navigation.
- Fix lazy session creation to avoid duplicate initialization.
- Fix prompt-training model disclosure.

### Changed

- Update the bundled CLI to include upstream OpenCode 1.15.13 changes.

## [7.0.1-rc.12] - 2026-06-18

### Added

- Provider settings management, including searchable provider lists, API-key configuration, OAuth provider login, provider enable/disable controls, disconnect actions, and shared provider metadata.
- Add copy controls to session messages so prompts and assistant responses can be copied directly from the transcript.
- Share codebase indexes across worktrees so Agent Manager and worktree sessions can use semantic search without duplicating the full index.

### Fixed

- Keep long JetBrains prompt input usable by capping growth, preserving scrolling, and hiding soft-wrap glyphs.
- Copy actions correctly in session.

### Changed

- Update the bundled CLI runtime to OpenCode 1.15.9

## [7.0.1-rc.11] - 2026-06-17

### Added

- Provider settings management, including provider catalog sections, provider descriptions, provider settings actions, disconnect flows, provider auth handling, and provider/model picker improvements.
- Session copy controls for chat messages.

### Fixed

- Cap JetBrains prompt input growth and hide soft wrap glyphs in the prompt field.
- Keep JetBrains provider toolbars and authentication overlays fixed, and improve provider API key dialog sizing.
- Clean up restartless unload behavior.
- Silence interrupted session notifications across clients.
- Always deny tool calls for system agents.

## [7.0.1-rc.10] - 2026-06-17

### Added

- Provider settings management, including provider catalog sections, provider descriptions, provider settings actions, disconnect flows, provider auth handling, and provider/model picker improvements.
- Session copy controls for chat messages.

### Fixed

- Cap JetBrains prompt input growth and hide soft wrap glyphs in the prompt field.
- Keep JetBrains provider toolbars and authentication overlays fixed, and improve provider API key dialog sizing.
- Clean up restartless unload behavior.
- Silence interrupted session notifications across clients.
- Always deny tool calls for system agents.

## [7.0.1-rc.9] - 2026-06-15

### Added

- Add prompt enhancement support.
- Support prompt and transcript attachments, including paste, drop, preview, and editor tab opening flows.

### Fixed

- Improve shell and markdown rendering, including code block spacing, terminal block retention, shell command highlighting, and session layout polish.

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
