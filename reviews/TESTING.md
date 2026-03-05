# Testing Guide — OpenCode v1.2.16 Merge (PR #6622)

This document covers:

1. [Manual test scenarios](#manual-test-scenarios) — things to verify by hand before merging
2. [Screenshot / visual regression tests to add](#screenshot--visual-regression-tests-to-add) — new automated coverage needed
3. [Build & type-check verification](#build--type-check-verification) — automated gates
4. [Edge cases and regression checks](#edge-cases-and-regression-checks)

---

## Manual Test Scenarios

### 🔴 Critical — Must Pass

#### 1. VS Code Extension compiles and loads

**Why:** `Code`/`Diff` → `File` component migration + export map overhaul are build-breaking.

Steps:

1. `cd packages/kilo-vscode && bun run build` — must produce zero TypeScript errors
2. Install the compiled `.vsix` in VS Code
3. Open any project and trigger the Kilo sidebar — the webview must load without a blank/error screen
4. Check the developer console for any `Cannot resolve module` or `undefined is not a function` errors

Expected: No build errors. Sidebar renders normally.

#### 2. File viewer (unified `File` component) renders code and diffs

**Why:** `Code`, `Diff`, and `DiffSSR` were deleted and replaced by a single `File` component.

Steps:

1. Start a session and ask Kilo to edit a file
2. Observe the diff view in the turn — it must show syntax-highlighted before/after diff
3. Ask Kilo to read a file — observe the file viewer rendering code with syntax highlighting
4. Open the full-screen diff panel (`DiffPanel` / `FullScreenDiffView`) — must render without errors
5. Test with a binary/image file — must show media preview, not garbled text

Expected: All file views render correctly in both the Chat panel and the full-screen diff view.

#### 3. Permission auto-accept behavior is correct

**Why:** `shouldAutoAccept` was removed — all permission types are now auto-accepted when the setting is on.

Steps:

1. Enable "auto-accept" for a new session
2. Trigger a **write** operation and verify it proceeds without prompting
3. Trigger a **read** operation — verify behavior matches intent (should it prompt or auto-accept?)
4. Trigger an **execute/shell** operation — this is the highest-risk case; verify the user is not silently exposed to command execution without consent
5. Verify the setting UI label accurately describes what it now enables

Expected: Either (a) the broadening is intentional and the UI label reflects it, or (b) `shouldAutoAccept` is scoped back to edit-only.

#### 4. Root `package.json` identity is correct

**Why:** Upstream overrode `name` and `repository` to `opencode` / `anomalyco/opencode`.

Steps:

1. `cat package.json | grep -E '"name"|"repository"'`
2. Name must be `@kilocode/kilo`
3. Repository URL must point to `github.com/Kilo-Org/kilocode`

Expected: Correct Kilo identity. CI pipeline depends on this.

#### 5. `openapi.json` has no merge conflict markers

**Why:** Unresolved `<<<<<<< HEAD` markers in `packages/sdk/openapi.json` cause build failure.

Steps:

1. `grep -n '<<<<<<<\|>>>>>>>\|=======' packages/sdk/openapi.json` — must return nothing
2. Verify the package name inside is `@kilocode/sdk`, not `@opencode-ai/sdk`

Expected: No conflict markers. Package name is `@kilocode/sdk`.

#### 6. i18n type safety is restored

**Why:** `en.ts` was typed as `Record<string, string>`, eliminating key validation.

Steps:

1. In `packages/ui/src/i18n/en.ts`, verify the export is **not** annotated with `Record<string, string>`
2. Introduce a deliberate typo in a `t('nonexistent.key')` call and confirm TypeScript reports an error
3. Run `bun turbo typecheck` — should have zero i18n-related type errors

Expected: Type errors for invalid i18n keys.

---

### 🟡 High Priority

#### 7. Session history scrolling with large sessions

**Why:** Session history now uses scroll-driven progressive reveal instead of idle-callback batching.

Steps:

1. Open a session with 100+ turns
2. Scroll up slowly — turns must progressively appear without layout jumps
3. Scroll back to the bottom — auto-scroll to latest must re-engage
4. Rapid-scroll to the top and back — no blank sections or infinite loop

Expected: Smooth progressive reveal, no blank turns, auto-scroll re-engages at bottom.

#### 8. Context overflow compaction and recovery

**Why:** New auto-compaction logic fires on HTTP 413 and replays the message.

Steps:

1. Build a session with a very large context (many file reads, long history)
2. Send another message that tips over the context limit
3. The session should auto-compact and then replay the last message seamlessly
4. Verify the user sees appropriate feedback (not a raw error)

Expected: Transparent compaction, message is replayed successfully.

#### 9. Provider icon display for custom/unknown providers

**Why:** The `icon()` fallback to `"synthetic"` was removed from provider dialogs.

Steps:

1. Add a custom OpenAI-compatible provider with an unknown/made-up ID
2. Open the provider selection dialog — the provider must show the `synthetic` fallback icon, not a broken SVG
3. Open Settings → Providers — same check

Expected: Unknown providers render the `synthetic` fallback icon.

#### 10. Prompt history with comments

**Why:** `prependHistoryEntry` gained a new `comments` parameter in 3rd position — silent API break.

Steps:

1. Submit several prompts, some with inline comments
2. Use Up arrow to navigate history — entries must cycle in correct order
3. Verify the `max` history cap is still respected (entries beyond the cap are dropped)

Expected: History navigation works correctly; no entries lost or duplicated.

#### 11. Provider icons — dark/light theme

**Why:** `302ai.svg` uses `fill="rgb(...)"` and `novita-ai.svg` uses `fill="black"` — invisible on dark backgrounds.

Steps:

1. Open the provider list or model picker in VS Code with a **dark theme**
2. Locate the 302.AI and Novita AI entries — icons must be visible
3. Switch to a **light theme** — icons must also be visible
4. Check `stepfun` icon — must look like the StepFun logo, not MiniMax

Expected: All provider icons visible on both themes, correct logos shown.

---

### 🟢 Medium Priority

#### 12. Auto-scroll click-to-stop behavior

**Why:** The click-to-stop mechanism was removed; the timeout was increased from 250ms to 1500ms.

Steps:

1. Start a streaming response
2. Click somewhere in the turn list — auto-scroll must stop
3. Scroll to the bottom manually — auto-scroll must re-engage
4. Verify the 1500ms pause after programmatic scroll does not feel laggy to users

Expected: Clicking stops auto-scroll; scrolling to bottom re-engages it.

#### 13. Tab close button visibility

**Why:** `tabs.css` removed `[data-hidden]` hide rule for close buttons — all tabs may now show close buttons permanently.

Steps:

1. Open multiple tabs in the Kilo UI
2. Observe unselected tabs — the close `×` button should only be visible on hover (or match previous behavior)
3. Verify the session-review panel tabs specifically

Expected: Tab close buttons do not appear on every tab permanently; behavior matches pre-merge.

#### 14. TUI with experimental markdown enabled by default

**Why:** `KILO_EXPERIMENTAL_MARKDOWN` now defaults to enabled.

Steps:

1. Run `kilo` in a terminal
2. Send a message with markdown: headers, bold, code blocks, lists, tables
3. Verify rendering is correct with `@opentui` 0.1.86
4. Check a response that includes a long code block — no truncation or garbling

Expected: Markdown renders cleanly in TUI. No visual artifacts.

#### 15. `KILO_EXPERIMENTAL_MARKDOWN` / `KILO` env var rename

**Why:** `OPENCODE` env prefix was renamed to `KILO`.

Steps:

1. Set `KILO_EXPERIMENTAL_MARKDOWN=false` and run the TUI — experimental markdown must be disabled
2. Verify any documentation or `.env.example` references are updated

Expected: New env var takes effect; old `OPENCODE_*` vars are no longer referenced in docs.

#### 16. MCP server management dialog — i18n

**Why:** 5 server management i18n keys are missing from non-English locales.

Steps:

1. Switch UI language to any non-English locale (e.g. German, French, Japanese)
2. Open the MCP server add/edit dialog
3. Verify field labels appear in the selected language, not raw English fallback strings

Expected: Localized strings shown; or if this is a known post-merge task, the English fallback is acceptable temporarily.

#### 17. Desktop auto-update manifest

**Why:** `finalize-latest-json.ts` checks `releaseId` instead of `version`, potentially producing `vundefined` URLs.

Steps:

1. Run a test/dry-run of the desktop release script
2. Inspect the generated `latest.json` — `url` fields must contain a real semver like `v1.2.16`, not `vundefined`

Expected: Valid version strings in the updater manifest.

---

## Screenshot / Visual Regression Tests to Add

These are new Playwright/screenshot tests that should be written to prevent regressions of the changes in this merge.

### High Priority (new components / high visual surface area)

| Test name                    | What to capture                                            | Variants           |
| ---------------------------- | ---------------------------------------------------------- | ------------------ |
| `file-viewer-code`           | Unified `File` component rendering a source file           | Light + dark theme |
| `file-viewer-diff`           | `File` component in diff mode (before/after)               | Light + dark theme |
| `file-viewer-media`          | `File` component with an image/binary file                 | Light              |
| `provider-icons-grid`        | All provider icons in the model picker                     | Light + dark theme |
| `provider-icons-unknown`     | Unknown provider shows `synthetic` fallback                | Light + dark       |
| `session-history-many-turns` | Session list with 50+ turns, scrolled to top               | —                  |
| `permission-dialog`          | Permission prompt modal for each type (read/write/execute) | —                  |

### Medium Priority (animation / layout changes)

| Test name               | What to capture                                         | Variants     |
| ----------------------- | ------------------------------------------------------- | ------------ |
| `todo-dock-animation`   | Todo dock open/closed/animating states                  | —            |
| `composer-animation`    | Composer panel expand/collapse                          | —            |
| `tabs-close-button`     | Tab bar with multiple tabs — close button visibility    | Light + dark |
| `session-review-layout` | `session-review.css` z-index and sticky header behavior | —            |
| `auto-scroll-indicator` | Scroll-to-bottom button appears/disappears as expected  | —            |

### Existing tests that should be updated

| Existing test                                          | Update needed                         |
| ------------------------------------------------------ | ------------------------------------- |
| Any test using `CodeComponentProvider`                 | Update to `FileComponentProvider`     |
| Any test using `DiffComponentProvider`                 | Remove or replace — component deleted |
| Any test using `useDiffComponent` / `useCodeComponent` | Update to `useFileComponent`          |
| Provider icon snapshot tests                           | Add new providers from this batch     |

---

## Build & Type-check Verification

Run these before declaring the merge ready:

```bash
# 1. Full typecheck (all packages)
bun turbo typecheck

# 2. VS Code extension build (most likely to fail)
cd packages/kilo-vscode && bun run build

# 3. kilo-ui package build
cd packages/kilo-ui && bun run build

# 4. SDK — verify no merge conflict markers remain
grep -rn '<<<<<<<\|>>>>>>>' packages/sdk/

# 5. Root package identity
node -e "const p = require('./package.json'); console.log(p.name, p.repository)"
# Expected: @kilocode/kilo  { ... Kilo-Org/kilocode ... }

# 6. i18n type check — verify UiI18nKey is a specific union, not string
grep -n 'Record<string' packages/ui/src/i18n/en.ts
# Expected: no output (annotation must not be present)

# 7. Confirm storybook debug log is removed
ls packages/storybook/debug-storybook.log
# Expected: file not found
```

---

## Edge Cases and Regression Checks

### Workspace isolation (new feature — inert but present)

- Verify that existing sessions without a `workspace_id` still load correctly (the new nullable column must default to `null`, not break existing rows)
- Confirm the new `workspace` table migration runs cleanly on existing databases: `SELECT * FROM workspace;` should return an empty result, not an error

### Session proxy (new middleware — dev-only)

- Confirm the `KILO_SESSION_PROXY` (or equivalent) feature flag is **off** by default in production builds
- If enabled in dev, test that a 404/500 from the session proxy returns a JSON error body, not plain text

### Compaction replay race condition

- Send a message that triggers compaction while another message is in-flight
- The session must not enter an inconsistent state (duplicate user messages, orphaned tool calls)

### Multi-locale smoke test

- Switch to each of the 16 supported locales
- Navigate to Settings → Providers and Settings → MCP Servers
- Verify no raw i18n key strings appear (e.g. `dialog.server.add.name`)

### Performance — `motion` bundle size

```bash
# Measure the extension webview bundle before and after this merge
cd packages/kilo-vscode
bun run build
du -sh dist/webview-ui/
# Compare to baseline; flag if > 10% increase
```

### Kilo-specific features still work end-to-end

- **Agent Manager**: Create a new agent session, assign a worktree, run a task — verify the multi-session panel is not broken by the workspace/session model changes
- **Model selection**: Change model mid-session — the provider icons and names should display correctly with the new icon batch
- **`@kilocode/sdk` import paths**: `import { KiloCode } from '@kilocode/sdk'` must resolve without errors in any package that uses it
