# Changelog

## 7.5.0

### Minor Changes

- [#12612](https://github.com/Kilo-Org/kilocode/pull/12612) [`a103f4a`](https://github.com/Kilo-Org/kilocode/commit/a103f4abf91c2d3192c11f18d4a56f54b0dafe25) - Improve JetBrains session change tracking: show the files each assistant turn modified with expandable per-file diffs, open inline and branch diffs in a refreshable diff viewer, and surface branch changes in the session header.

## 7.5.0

### Minor Changes

- [#12518](https://github.com/Kilo-Org/kilocode/pull/12518) [`452d0eb`](https://github.com/Kilo-Org/kilocode/commit/452d0eb55f740e951cfd906375e22cf97250144c) - Publish a signed GitHub-hosted JetBrains plugin build with the CLI bundled for offline installation.

### Patch Changes

- [#12571](https://github.com/Kilo-Org/kilocode/pull/12571) [`9950739`](https://github.com/Kilo-Org/kilocode/commit/9950739e36b40a682c0a25173e62f5236e60f81a) - Allow sending prompts while a session is busy and show queued prompts with a remove action.

## 7.4.16

### Patch Changes

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`2b13e7d`](https://github.com/Kilo-Org/kilocode/commit/2b13e7da2a6a776baeb2d797cd5aaeb07a526c0b) - Improve JetBrains diff previews by hiding hunk headers and adding full-path tooltips to clickable file links.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`5c526f1`](https://github.com/Kilo-Org/kilocode/commit/5c526f140b78b13608ad3855532f5215c0b29675) - Render edit tool results with a clickable file target and a highlighted, simplified diff view.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`73942c3`](https://github.com/Kilo-Org/kilocode/commit/73942c3f262dda53030d748e6c08f84db2384253) - Open edit tool file links directly when multiple files share the same name.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`dd31044`](https://github.com/Kilo-Org/kilocode/commit/dd3104400840e1b4641097bf892e25dfccfd592d) - Render multi-file apply_patch edits as a "Patch" with a file-count tag and one section per file, each showing a clickable filename link and its own changes badge aligned with the diff.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`79e606e`](https://github.com/Kilo-Org/kilocode/commit/79e606ebcbb15d20b5fde29d614f07270b1c0b3d) - Smooth out chat scrolling in large JetBrains sessions by only refreshing hover state for the message under the pointer.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`95ae0e0`](https://github.com/Kilo-Org/kilocode/commit/95ae0e0b3b066ec5ab60c36b7bcffb973a942872) - Improve chat scrolling performance in large JetBrains sessions.

- [#12491](https://github.com/Kilo-Org/kilocode/pull/12491) [`b2a3a8d`](https://github.com/Kilo-Org/kilocode/commit/b2a3a8dc10d5f579396e1bd76e16a0eef696bede) - Size edit and shell preview popovers to their content with a wider maximum width.

## 7.5.0

### Minor Changes

- [#12437](https://github.com/Kilo-Org/kilocode/pull/12437) [`af33ede`](https://github.com/Kilo-Org/kilocode/commit/af33eded9e4ac1988d218e911b5ff0d4e1b9d8b1) - Add Rules settings for instruction files and Claude Code compatibility. Fix cloud session history import failing with an HTTP 400 error.

- [#12416](https://github.com/Kilo-Org/kilocode/pull/12416) [`a9a9b78`](https://github.com/Kilo-Org/kilocode/commit/a9a9b78b97290e855cda3dd7118a429503802396) - Support viewing, opening, editing, deleting, and configuring JetBrains skill sources.

### Patch Changes

- [#12291](https://github.com/Kilo-Org/kilocode/pull/12291) [`0672375`](https://github.com/Kilo-Org/kilocode/commit/067237564a170e84bc60f42b50bcba99ba9fe0c3) - Improve the JetBrains permission dialog with clearer auto-approve rule actions, hints, and command styling.

- [#12291](https://github.com/Kilo-Org/kilocode/pull/12291) [`e9d0af5`](https://github.com/Kilo-Org/kilocode/commit/e9d0af577359e27728d4b47442d861ac2e5c6e1e) - Honor saved JetBrains bash permission rules when running with isolated dev storage.

## 7.4.12

### Patch Changes

- [#12191](https://github.com/Kilo-Org/kilocode/pull/12191) [`4d676b6`](https://github.com/Kilo-Org/kilocode/commit/4d676b68d2d0dd025c7d1a6684f49f3d03e9d12d) - Use Kilo Core for JetBrains @ file completion.

## 7.4.10

### Patch Changes

- [#12217](https://github.com/Kilo-Org/kilocode/pull/12217) [`d6b36a0`](https://github.com/Kilo-Org/kilocode/commit/d6b36a028cc0a4b7bfd158d75e287c110e2838f7) - Support editing custom OpenAI-compatible providers from JetBrains settings and replace their Disconnect action with Edit and Delete. Added or edited providers stay selected, and the custom provider dialog now closes after a successful save.

- [#12217](https://github.com/Kilo-Org/kilocode/pull/12217) [`6077c1c`](https://github.com/Kilo-Org/kilocode/commit/6077c1c3b36d4c5cd68f206fc146ca472d841c5e) - Fix adding a Custom OpenAI-Compatible Provider silently failing. The dialog now requires at least one model and reports save errors inline so you can correct your input and retry without re-entering the form.

- [#12217](https://github.com/Kilo-Org/kilocode/pull/12217) [`cae3270`](https://github.com/Kilo-Org/kilocode/commit/cae3270c9dacc4097a681539cf3e07cfadceaca7) - Match the model picker Close button styling to JetBrains dialog primary buttons.

- [#12217](https://github.com/Kilo-Org/kilocode/pull/12217) [`cae3270`](https://github.com/Kilo-Org/kilocode/commit/cae3270c9dacc4097a681539cf3e07cfadceaca7) - Use a trash icon for provider delete and show provider edit/delete actions on selection, matching the other settings lists.

## 7.4.6

### Patch Changes

- [#12215](https://github.com/Kilo-Org/kilocode/pull/12215) [`9f9509d`](https://github.com/Kilo-Org/kilocode/commit/9f9509dde55678c5f84b00741dca7f439237b467) - Scale the Kilo session UI with IntelliJ IDE zoom and presentation mode.

- [#12188](https://github.com/Kilo-Org/kilocode/pull/12188) [`349f972`](https://github.com/Kilo-Org/kilocode/commit/349f9723f55662ee4598d933c09264aae575df98) - Migrate legacy v5 markdown to-do lists into populated JetBrains To-dos cards.

- [#12188](https://github.com/Kilo-Org/kilocode/pull/12188) [`048a0ee`](https://github.com/Kilo-Org/kilocode/commit/048a0ee52e8a26930787e3d1fcf41b4a3b5bd57b) - Render tools from imported legacy v5 sessions in assistant turns instead of prompt bubbles.

- [#12188](https://github.com/Kilo-Org/kilocode/pull/12188) [`17b0b22`](https://github.com/Kilo-Org/kilocode/commit/17b0b22d4432276ac314a2bbe9751d52f765dd47) - Import legacy v5 JetBrains settings and sessions through the migration wizard.

- [#12188](https://github.com/Kilo-Org/kilocode/pull/12188) [`8a859e4`](https://github.com/Kilo-Org/kilocode/commit/8a859e49bdd0e15c9a3598945f48dbe1d48bc1b3) - Add a "Later" option to the legacy migration wizard that defers the prompt to the next startup, and stop reporting the language preference as migrated since it cannot be applied in this version.

- [#12214](https://github.com/Kilo-Org/kilocode/pull/12214) [`737993e`](https://github.com/Kilo-Org/kilocode/commit/737993e21c03f89ead970281915eeca5db0349ab) - Honor JetBrains certificate and proxy settings when downloading the CLI and fetching custom provider models.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`18e798e`](https://github.com/Kilo-Org/kilocode/commit/18e798e81cd3a6584c6820c9ac710ceac24d0a97) - Use the IntelliJ stop icon for the JetBrains prompt stop button.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`de06c40`](https://github.com/Kilo-Org/kilocode/commit/de06c407f91fd8131c6c703386b1684e3cf0e363) - Show elapsed time in the JetBrains progress footer while Kilo is working.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`b62105a`](https://github.com/Kilo-Org/kilocode/commit/b62105a6490b268526eca51ff139934f36d0d6b0) - Add a separator before the JetBrains prompt send button.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`b62105a`](https://github.com/Kilo-Org/kilocode/commit/b62105a6490b268526eca51ff139934f36d0d6b0) - Match the JetBrains prompt send-button right padding to the bottom padding.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`5c98a0d`](https://github.com/Kilo-Org/kilocode/commit/5c98a0d1d407efb06f92496fc66f1c823f12d577) - Fix JetBrains rollback and redo scrolling and align plan custom response font with the prompt input.

- [#12180](https://github.com/Kilo-Org/kilocode/pull/12180) [`18e798e`](https://github.com/Kilo-Org/kilocode/commit/18e798e81cd3a6584c6820c9ac710ceac24d0a97) - Match the JetBrains prompt send icon color to the scroll-to-bottom button across themes.

## 7.4.6

### Patch Changes

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`42a4966`](https://github.com/Kilo-Org/kilocode/commit/42a49667a946a2f4f22df44b82aa5c3ff11f9aee) - Return keyboard focus to the JetBrains prompt after clicking inline session dialog actions.

- [#12105](https://github.com/Kilo-Org/kilocode/pull/12105) [`8ceeb0f`](https://github.com/Kilo-Org/kilocode/commit/8ceeb0fb990911f5dc4647f7f9d75b26f5ce0ec4) - Stop orphaned Kilo CLI processes when JetBrains IDEs close, including binaries that ignore graceful shutdown.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`39cec20`](https://github.com/Kilo-Org/kilocode/commit/39cec2063572368462acd3347bbf588991f366e2) - Refresh the JetBrains prompt input chrome when switching IDE themes.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`04a1aa1`](https://github.com/Kilo-Org/kilocode/commit/04a1aa1b123f1b64591786d32fd58a30019fe007) - Polish JetBrains prompt focus and copy toolbar positioning.

- [#12104](https://github.com/Kilo-Org/kilocode/pull/12104) [`c1b206b`](https://github.com/Kilo-Org/kilocode/commit/c1b206b161b8376355fdb2c16a7f4e972e7806fd) - Show rollback/redo progress inline (on the message and redo controls) with a cancel action instead of a full-screen loading overlay.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`7e7ab7e`](https://github.com/Kilo-Org/kilocode/commit/7e7ab7e795ca0922f16bfa549d088c23fe631c2f) - Support rollback and redo controls in JetBrains sessions and clarify when reverted changes can be redone.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`c1415d2`](https://github.com/Kilo-Org/kilocode/commit/c1415d2879bd7eb38910df43f7593cd641dbd343) - Clarify in JetBrains rollback that only the conversation was reverted when snapshots are disabled.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`eb8950c`](https://github.com/Kilo-Org/kilocode/commit/eb8950c1efc3386ebc479c09298187768c6e0cc5) - Polish JetBrains session message toolbar alignment, rollback icon, and copy tooltips.

- [#12059](https://github.com/Kilo-Org/kilocode/pull/12059) [`8ea3f10`](https://github.com/Kilo-Org/kilocode/commit/8ea3f10495e28c8a131b805d51f8f7524895148b) - Increase spacing before non-initial user prompts in the JetBrains session transcript.

## [Unreleased]

## [7.0.12-rc.4] - 2026-08-01

### Fixed
- Improve large branch diff performance by capping huge inline diff previews, compacting diff tree paths, and allowing horizontal scrolling for long file names.
- Reflow existing long chat sessions after they load so transcripts lay out at the correct width without needing to resize the tool window.
- Keep the prompt send/stop button synchronized when attachments are added, removed, or cleared while a session is busy.
- Reduce transcript restyling work during streaming so large sessions remain responsive.
- Hide expanded diff folder badges and refresh diff tree layout correctly when folders are toggled.

## [7.0.12-rc.3] - 2026-07-31

### Added

- feat(agent-manager): add embedded side-panel terminal destination by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12598
- feat(opencode): route websearch Exa through Kilo proxy by @IamCoder18 in https://github.com/Kilo-Org/kilocode/pull/12470
- feat(agent-manager): reveal jump shortcut badges while modifier is held by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12631
- feat(vscode): add prompt navigator rail to chat transcript by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12632
- feat(agent-manager): support multiple side-panel terminals by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12633
- feat(agent-manager): show worktree name on hover card by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12634
- feat(tui): make Context and Token Usage sidebar sections collapsible by @IamCoder18 in https://github.com/Kilo-Org/kilocode/pull/11986
- feat(tui): register `/auto-approve` slash command for toggling auto-approve mode by @IamCoder18 in https://github.com/Kilo-Org/kilocode/pull/12444
- feat(i18n): mention @ file references in chat input placeholder by @sylwester-liljegren in https://github.com/Kilo-Org/kilocode/pull/11984
- feat(telemetry): include host OS properties by @chrarnoldus in https://github.com/Kilo-Org/kilocode/pull/12641
- feat(vscode): add Persian (Farsi) UI language by @bsflasher in https://github.com/Kilo-Org/kilocode/pull/12424
- feat(agent-manager): add diff scope selector by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12681
- feat(agent-manager): run project scripts in the selected terminal by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12680
- feat: configure web search availability for all providers by @lambertjosh in https://github.com/Kilo-Org/kilocode/pull/12369
- feat(tui): execute cmds in skill context by @bagatao-anaconda in https://github.com/Kilo-Org/kilocode/pull/12604
- feat(vscode): multi-project Agent Manager by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12566
- feat(agent-manager): key diff review by selection with per-session scope by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12709
- feat(agent-manager): run setup scripts in panel terminal by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12703
- feat(vscode): show verbatim skill commands and skill name in permission prompt by @bagatao-anaconda in https://github.com/Kilo-Org/kilocode/pull/12606
- feat(jetbrains): show verbatim skill commands and skill name in permission prompt by @bagatao-anaconda in https://github.com/Kilo-Org/kilocode/pull/12724
- feat(jetbrains): improve session changes and diff review by @kirillk in https://github.com/Kilo-Org/kilocode/pull/12612

### Fixed

- fix(cli): enforce permissions on shell commands the parser fails to scan by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12585
- fix(ci): docs-sync bot — no errors, no timeouts, no lost PRs by @iscekic in https://github.com/Kilo-Org/kilocode/pull/12580
- fix(cli): prevent agent-loop freeze when a provider stalls after headers by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12588
- fix(cli): keep session reverts atomic by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12587
- fix(vscode): avoid eager worktree watchers by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12593
- fix(nix): use the required Bun version for builds by @noobezlol in https://github.com/Kilo-Org/kilocode/pull/12592
- fix(vscode): show prompt input toggle tooltips instantly by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12591
- fix: make snapshot diffs resilient on Windows by @noobezlol in https://github.com/Kilo-Org/kilocode/pull/12583
- fix(cli): include credentials in console URLs printed for headless users by @IamCoder18 in https://github.com/Kilo-Org/kilocode/pull/12333
- fix(vscode): make message copy buttons reliable by @mjnaderi in https://github.com/Kilo-Org/kilocode/pull/12123
- fix(ci): authenticate JetBrains OpenAPI codegen GitHub API calls by @kirillk in https://github.com/Kilo-Org/kilocode/pull/12603
- fix(agent-manager): keep terminal destination consistent across windows by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12629
- fix(vscode): speed up embedded terminal startup and fix cold-connection race by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12630
- fix(cli): exclude gpt-5.6 from ChatGPT subscriptions by @chrarnoldus in https://github.com/Kilo-Org/kilocode/pull/12601
- fix(vscode): stop flashing interruption warning on queued follow-up handoff by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12639
- fix(cli): promote stable releases to rc by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12647
- fix(agent-manager): keep terminal cursor visible by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12658
- fix(ci): docs-sync bot passes --auto, drains its backlog, and reports readable causes; fix(cli): honest exit codes for headless runs by @iscekic in https://github.com/Kilo-Org/kilocode/pull/12605
- fix(vscode): persist MCP server toggle state by @Hardik180704 in https://github.com/Kilo-Org/kilocode/pull/12624
- fix(vscode): improve long-session prompt navigation by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12656
- fix(cli): remove unset config keys from every layered config file by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12687
- fix(cli): reduce startup time by deferring Kilo module loading and telemetry work by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12682
- fix(agent-manager): make Cmd+/ terminal toggle reliable and sidebar-safe by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12691
- fix(vscode): list past chats across the worktree family by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12692
- fix(core): include underlying reason in ripgrep execution failures by @chrarnoldus in https://github.com/Kilo-Org/kilocode/pull/12684
- fix(agent-manager): open terminal when switching worktrees by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12689
- fix(agent-manager): align panel terminal tabs with session tabs by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12693
- fix(agent-manager): propagate base branch override to active diff source by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12696
- fix(agent-manager): align Cmd+/ fallback with platform binding and one-shot echo by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12694
- fix(cli): settle signal-terminated shell commands as 128 + signum by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12698
- fix(memory): accept extra digest fields by @Hardik180704 in https://github.com/Kilo-Org/kilocode/pull/12675
- fix: surface provider error details from Responses API stream failures by @chrarnoldus in https://github.com/Kilo-Org/kilocode/pull/12700
- fix(docs-sync): intercept revert PRs and calibrate prompts by @iscekic in https://github.com/Kilo-Org/kilocode/pull/12708
- fix(vscode): restore Agent Manager terminals by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12720
- fix(agent-manager): keep detail pane for unassigned sessions by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12722
- fix(cli): stabilize Windows CI tests and rebalance slow shards by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12723
- fix(cli): handle missing nested config unsets by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12727
- fix(indexing): improvements to semantic_search tool description by @shssoichiro in https://github.com/Kilo-Org/kilocode/pull/12227
- fix(vscode): make cache hit rate write-aware by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12738
- fix(cli): suppress AI SDK system message warning in TUI by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12739

### Changed

- release(jetbrains): v7.0.12-rc.2 by @kilo-maintainer[bot] in https://github.com/Kilo-Org/kilocode/pull/12581
- chore(opencode): merge v1.17.6 through v1.17.9 by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12460
- refactor(vscode): remove dead code from Agent Manager by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12594
- refactor(vscode): remove unused webview context APIs and orphaned CSS by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12596
- chore(vscode): remove unused translation keys by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12602
- refactor(vscode): extract apply-to-local and worktree diff workflows out of AgentManagerApp by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12636
- refactor(agent-manager): namespace terminal keys by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12635
- refactor(vscode): share webview provider shell by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12648
- refactor(agent-manager): consolidate import transaction by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12651
- refactor(vscode): deduplicate config snapshots by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12650
- chore(jetbrains): centralize test dependency versions by @hdcodedev in https://github.com/Kilo-Org/kilocode/pull/12608
- docs(kilo-docs): add documentation for referencing past chats via @ mentions by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12662
- docs: document Shift+Tab shortcut for cycling reasoning effort variants by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12661
- docs(kilo-docs): mention JetBrains in auto-approve settings by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12669
- docs(kilo-docs): document JetBrains plugin settings by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12668
- docs: document mobile app remote sessions, PR review, and session cost by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12667
- docs(checkpoints): document revert banner warnings and snapshot restoration by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12663
- Update the Cerebras provider example by @ryanl-cerebras in https://github.com/Kilo-Org/kilocode/pull/12620
- docs(agent-manager): document session overview, prompt, and stop by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12660
- refactor(cli): remove provably unused kilocode code by @marius-kilocode in https://github.com/Kilo-Org/kilocode/pull/12599
- docs: add Mixlayer provider page by @sodiumsun in https://github.com/Kilo-Org/kilocode/pull/12500
- docs(kilo-docs): document kilo cloud CLI usage and skill archives by @emilieschario in https://github.com/Kilo-Org/kilocode/pull/12664
- docs: add NVIDIA to BYOK providers by @lambertjosh in https://github.com/Kilo-Org/kilocode/pull/12576
- chore(jetbrains): bump CLI pin to v7.4.17 by @kilo-maintainer[bot] in https://github.com/Kilo-Org/kilocode/pull/12644
- docs(cli): deprecate Kilo Console by @lambertjosh in https://github.com/Kilo-Org/kilocode/pull/12701

## [7.0.12-rc.2] - 2026-07-27

### Added

### Fixed

- Fix the GitHub-hosted bundled JetBrains plugin build so signing uses certificate and private-key files during verification.

### Changed

## [7.0.12-rc.1] - 2026-07-27

### Added

- Support sending another JetBrains prompt while a session is still running. Queued prompts now appear in the conversation and can be removed before Kilo starts processing them.

## [7.0.11] - 2026-07-27

### Added

- Add a signed GitHub-hosted bundled JetBrains plugin build that includes the Kilo CLI for offline or restricted-network installs.

### Fixed

- Load global skills reliably from JetBrains projects that are not inside a Git repository.
- Support adaptive thinking for Claude Opus and Sonnet 5+ model identifiers across Anthropic, AI Gateway, and Bedrock providers.
- Flush pending cloud session updates when the Kilo Core runtime shuts down, reducing cases where the final assistant message is missing when a session is reopened elsewhere.
- Prune stale bundled CLI versions after upgrading bundled JetBrains installs.

### Changed

- Update the JetBrains CLI pin from Kilo Core 7.4.15 to 7.4.16.

## [7.0.10] - 2026-07-24

## [7.0.10] - 2026-07-24

### Added

- Render edit, write, and apply-patch tool results as expandable diff previews with clickable file links, change counts, syntax-highlighted diffs, and clearer multi-file patch sections.

### Fixed

- Improve session performance for large transcripts.
- Fix Kilo Core failures caused by strict OpenAI-compatible compaction requests, unexpected provider finish reasons, read-only database files at startup, AWS profile credentials, and config files being rewritten just by reading them.

### Changed

- Update the JetBrains CLI pin from Kilo Core 7.4.13 to 7.4.15.

## [7.0.9] - 2026-07-21

### Added

- Add a Rules settings page under Agent Behavior for managing instruction files and Claude Code compatibility.

### Fixed

- Restore importing cloud-only session history by updating the JetBrains CLI pin to Kilo Core 7.4.13.

### Changed

- Improve xAI prompt cache usage in Kilo Core for better cache hit rates.

## [7.0.8] - 2026-07-21

### Added

- Add settings for context controls, including context mentions and ignore patterns.
- Add settings for skills, including editing local skills and viewing remote skills as read-only.
- Add auto-approve settings for permission rules, with filters and wildcard labels.
- Use Kilo Core for JetBrains file mention search so @-mentions match CLI indexing behavior.

### Fixed

### Changed

- Update the JetBrains CLI pin from Kilo Core 7.4.5 to 7.4.11.

## [7.0.7] - 2026-07-15

### Added

- Add support for OpenAI-compatible custom providers.

### Fixed

- Improve custom provider setup by validating required fields and showing configuration errors in the dialog.
- Close the custom provider dialog correctly after adding a provider.
- Clean up deleted custom providers by using the disconnect flow.

### Changed

- Keep the JetBrains plugin pinned to Kilo Core 7.4.5 for this release.

## [7.0.6] - 2026-07-14

### Fixed

- Honor the IDE's certificate and proxy settings for outbound HTTPS requests.
- Scale the session UI correctly with IDE zoom, fixing double-scaled heights and extra empty space in the transcript and prompt composer.

## [7.0.5] - 2026-07-14

### Added

- Add an elapsed-time indicator to the session progress footer so long-running tasks show how long they have been active.
- Support importing legacy JetBrains v5 data directly from raw storage when the previous consolidated migration file is unavailable.

### Fixed

- Restore the v5 migration wizard for users whose legacy provider, OAuth, MCP, mode, setting, or session data was not detected during upgrade.
- Improve migration reliability by preserving checklist todos, importing legacy tool calls as assistant parts, validating raw session IDs, and reducing migration memory usage.
- Polish session controls with more native prompt icons, progress footer spacing, auto-hiding prompt scrollbars, and improved rollback/redo scrolling.

### Changed

- Keep the JetBrains plugin pinned to Kilo Core 7.4.5 for this release.

## [7.0.4] - 2026-07-10

### Fixed

- Stop orphaned Kilo Core processes on Windows so closing the IDE no longer leaves a lingering `kilo serve` process or blocks the next IDE launch.
- Improve JetBrains CLI shutdown ordering so app close kills the process tree before closing streams, preventing Windows shutdown deadlocks.

## [7.0.3] - 2026-07-10

### Added

- Add rollback redo controls in JetBrains sessions so reverted changes can be restored from the chat UI.
- Add inline revert progress in JetBrains sessions, including localized status text and safer cancellation handling.
- Add Kilo Core support for localized commit-message generation, AI image generation, large bash-output pruning, and improved model-usage display.

### Fixed

- Harden Kilo Core startup and shutdown so startup failures show clearer diagnostics, app close stops the CLI process, and lingering child processes are cleaned up more reliably.
- Fix workspace reload recovery so stale reload state no longer disrupts the session connection.
- Fix JetBrains rollback and revert flows so prompt focus, scroll state, diff order, and turn state are preserved more reliably.
- Fix Kilo Core Bedrock SSO credential resolution and commit-message error handling when no changes are available.

### Changed

- Update the JetBrains plugin to download Kilo Core 7.4.5.

## [Unreleased]

## [7.0.2] - 2026-07-07

### Added

- First GA release of the native Kilo extension for JetBrains IDEs.
- Download the pinned Kilo Core release at runtime instead of bundling CLI binaries, keeping the JetBrains plugin smaller while verifying downloaded archives before use.
- Show Kilo Core runtime details from the JetBrains plugin so users can see which Core release is active.

### Fixed

- Improve JetBrains runtime CLI download reliability by pruning stale binaries, using the shell environment for PATH resolution, and surfacing exact release-resolution failures.

### Changed

- Polish JetBrains chat UI with auto-collapsing reasoning previews, clearer retry/offline footer state, and more balanced prompt, code, question, todo, history, and popup spacing.
- Show the active routed model name and remote status more consistently in CLI runtime surfaces.

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
