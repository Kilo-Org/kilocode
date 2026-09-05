# Kilo v2 CLI/TUI Scenario Test Plan

> **Scope:** Interactive CLI/TUI scenarios, including startup, branding, theme/dimensions, BB terminal lifecycle, slash commands, model picker, agent selection and policies, native Plan mode, Kilo settings, memory UI and modal, and status/sidebar truthfulness.
>
> **Status:** **ALL MANUAL TESTS NOT RUN.**
>
> **Index & Companion:** Main test plan index is [`plans/kilo-opencode-v2-test-plan.md`](kilo-opencode-v2-test-plan.md). Companion runtime/security plan is [`plans/kilo-opencode-v2-test-plan-runtime.md`](kilo-opencode-v2-test-plan-runtime.md). VS Code and JetBrains extension testing is deferred.
> **Conventions:** Automated test references (`packages/kilo-cli/test/...`) represent related automated harness coverage only; they do not certify a manual pass or live deployed service. Any live account, paid model inference, remote sharing, or destructive action is labeled **USER-OPT-IN** or **FIXTURE-ONLY**.

---

## High-Level Execution Matrix & Verification Summary

| Section | Domain / Capability | IDs | Case Count | Manual Status |
|---|---|---|---|---|
| 1 | Startup, Branding, Themes & Dimensions | UI-001 – UI-009 | 9 | NOT RUN |
| 2 | BB Terminal Lifecycle & Resize Resilience | UI-010 – UI-014 | 5 | NOT RUN |
| 3 | Command Palette & Slash Command Deduplication | UI-015 – UI-022 | 8 | NOT RUN |
| 4 | Model Picker Presentation, Groups, Filtering & Privacy | UI-023 – UI-034 | 12 | NOT RUN |
| 5 | Agent Selection, Ask/Debug Boundaries & Custom Agents | UI-035 – UI-042 | 8 | NOT RUN |
| 6 | Plan Mode Workflow, Save Consent & Completion Gates | UI-043 – UI-056 | 14 | NOT RUN |
| 7 | Kilo Settings UI Scopes, Precedence & Validation | UI-057 – UI-066 | 10 | NOT RUN |
| 8 | Memory UI: Compact Sidebar, Dialog & Toggle Controls | UI-067 – UI-074 | 8 | NOT RUN |
| 9 | Sidebar Truthfulness: Credits, Indexing & Usage | UI-075 – UI-080 | 6 | NOT RUN |
| **Total** | | **UI-001 – UI-080** | **80 Cases** | **NOT RUN** |

---

## Shared Test Setup & Environment Isolation

Before running manual interactive CLI/TUI scenarios, prepare an isolated environment to prevent polluting the developer's real `~/.config/kilo`, `~/.local/share/kilo`, or production profiles:

```sh
# Run this setup from the repository root. Keep the calling shell unchanged.
KILO_BIN="$PWD/packages/kilo-cli/dist/interactive/kilo2"
KILO_TEST_ROOT="$(mktemp -d /tmp/kilo-ui-test-XXXXXX)"
KILO_TEST_HOME="$KILO_TEST_ROOT/home"
KILO_TEST_PROJECT="$KILO_TEST_ROOT/project"
mkdir -p "$KILO_TEST_HOME" "$KILO_TEST_PROJECT" "$KILO_TEST_ROOT/tmp"

# Scrub inherited provider credentials/config and scope isolation to the child.
kilo_test() {
  env -i PATH="$PATH" TERM="${TERM:-xterm-256color}" LANG="${LANG:-en_US.UTF-8}" \
    HOME="$KILO_TEST_HOME" USERPROFILE="$KILO_TEST_HOME" \
    XDG_DATA_HOME="$KILO_TEST_HOME/data" XDG_CONFIG_HOME="$KILO_TEST_HOME/config" \
    XDG_CACHE_HOME="$KILO_TEST_HOME/cache" XDG_STATE_HOME="$KILO_TEST_HOME/state" \
    TMPDIR="$KILO_TEST_ROOT/tmp" "$KILO_BIN" "$@"
}
cd "$KILO_TEST_PROJECT"
kilo_test
```

In the cases below, “launch `$KILO_BIN`” means call `kilo_test` so isolation is
retained. Add only a case's explicitly approved environment values to this
child command; the clean environment intentionally omits live credentials.
After all child processes exit, inspect the printed value of `KILO_TEST_ROOT`
and move only that exact disposable directory to Trash. Do not remove paths
through an unresolved variable or change the calling shell's `HOME`.

---

## 1. Startup, Branding, Themes & Dimensions

### UI-001: Clean interactive launch with isolated profile
* **Priority:** High
* **Prerequisites:** Shared environment isolation configured (`KILO_TEST_ROOT`). Binary `$KILO_BIN` built and executable.
* **Steps:**
  1. Change directory to `$KILO_TEST_PROJECT`.
  2. Launch `$KILO_BIN`.
  3. Observe the alternate screen buffer initialization.
  4. Inspect the header, sidebar, status bar, and composer prompt.
* **Expected:** TUI boots into interactive session without error toasts or unhandled promise rejections. Title shows session frame. Prompt input is focused. No files are created outside `$KILO_TEST_ROOT`.
* **Cleanup:** Exit session with `/exit` or `Ctrl+C`.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/interactive.test.ts`.

### UI-002: Kilo ASCII logo branding in home splash
* **Priority:** Medium
* **Prerequisites:** Fresh interactive session on standard terminal (80x24) in `$KILO_TEST_PROJECT`.
* **Steps:**
  1. Launch `$KILO_BIN`.
  2. Inspect the application logo rendered in the initial home view (`#kilo-home-logo`).
  3. Verify whether modern Unicode or ASCII fallback artwork is selected.
* **Expected:** Brand renders "Kilo" distinctively via `packages/kilo-cli/src/tui-plugin/logo.tsx` using `packages/kilo-cli/src/tui-plugin/logo-data.ts`. No raw "OpenCode" upstream unbranded artifact appears in the home logo slot.
* **Cleanup:** Close session with `/exit`.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/logo.test.tsx` and `packages/kilo-cli/test/teams-fixture.tsx`.

### UI-003: Light theme contrast and token mapping (`solarized`)
* **Priority:** Medium
* **Prerequisites:** Interactive session running in light terminal emulator (or light background preset). Built-in theme `solarized` present in `packages/tui/src/theme/assets/solarized.json`.
* **Steps:**
  1. Open theme picker via `/theme`.
  2. Select `solarized`.
  3. Inspect readability of text tokens: default text, subdued text, and prompt input.
* **Expected:** All text tokens map to semantic roles (`theme.text.default`, `theme.text.subdued`, `theme.background.default`). Background is light; foreground text is legible dark ink. No unmapped invisible white-on-white text occurs.
* **Cleanup:** Switch theme back to default dark via `/theme`.
* **Evidence / Limitations:** Validated against built-in themes in `packages/tui/src/theme/v1.ts` (`DEFAULT_THEMES`).

### UI-004: Dark theme contrast and token mapping (`tokyonight`)
* **Priority:** Medium
* **Prerequisites:** Standard dark terminal emulator (80x24). Built-in theme `tokyonight` present in `packages/tui/src/theme/assets/tokyonight.json`.
* **Steps:**
  1. Launch interactive session.
  2. Open theme selector via `/theme`.
  3. Switch to `tokyonight` (or `one-dark`, `dracula`).
  4. Inspect sidebar border, tab pulse, and action buttons.
* **Expected:** Dark background renders properly. Accents and feedback tones (success green, warning amber, error red) meet contrast requirements.
* **Cleanup:** Revert to default theme.
* **Evidence / Limitations:** Verified via `packages/tui/src/theme/v1.ts`.

### UI-005: Narrow terminal layout (80 columns minimum constraint)
* **Priority:** High
* **Prerequisites:** Terminal resized to exactly 80 columns by 24 rows (`stty cols 80 rows 24`).
* **Steps:**
  1. Launch `$KILO_BIN`.
  2. Observe sidebar collapsing or wrapping behavior.
  3. Type a 120-character prompt in composer and observe wrapping.
* **Expected:** Interface fits within 80 columns without broken ANSI wrap or clipped left margins. Prompt input wraps inside composer boundaries.
* **Cleanup:** Restore terminal to standard width (120x35).
* **Evidence / Limitations:** Automated harness reference: `packages/tui/test/mini/footer.responsive.test.tsx`.

### UI-006: Wide terminal layout (160+ columns expansion)
* **Priority:** Medium
* **Prerequisites:** Terminal resized to 160 columns by 45 rows (`stty cols 160 rows 45`).
* **Steps:**
  1. Launch interactive session.
  2. Inspect message list width, sidebar allocation, and diff viewer margins.
  3. Open `/stats` or a diff viewer pane.
* **Expected:** Layout expands gracefully without excessive empty deadspace or distorted flex columns. Sidebar maintains fixed/bounded proportional width.
* **Cleanup:** Restore standard terminal size.
* **Evidence / Limitations:** Automated harness reference: `packages/tui/test/cli/tui/diff-viewer.test.tsx`.

### UI-007: Short terminal viewport (15 rows vertical compression)
* **Priority:** Medium
* **Prerequisites:** Terminal resized to 100 columns by 15 rows (`stty cols 100 rows 15`).
* **Steps:**
  1. Launch interactive session.
  2. Open a dialog (e.g., `/models` or `/kilo-settings`).
  3. Navigate list with Up/Down arrows.
* **Expected:** Dialog fits within visible rows; option list scrolls with visible active selection indicator. Header and footer do not push dialog select actions off-screen.
* **Cleanup:** Restore terminal height.
* **Evidence / Limitations:** Handled by dialog select component in `packages/tui/src/ui/dialog-select.tsx`.

### UI-008: Multi-line composer input expansion and scrolling
* **Priority:** Medium
* **Prerequisites:** Standard interactive session.
* **Steps:**
  1. In composer, type 5 consecutive lines using `Shift+Enter` (or literal newline).
  2. Continue typing up to 10 lines of text.
  3. Press Up and Down arrows to navigate between lines.
* **Expected:** Composer height grows up to maximum configured ceiling and then scrolls internally. Message history above shifts upward without clobbering the status line.
* **Cleanup:** Clear prompt with `Ctrl+U` or `Escape`.
* **Evidence / Limitations:** Managed in `packages/tui/src/component/prompt/index.tsx`.

### UI-009: ANSI color escape suppression and raw terminal fallback
* **Priority:** Low
* **Prerequisites:** Environment variable `NO_COLOR=1` set.
* **Steps:**
  1. Launch `NO_COLOR=1 "$KILO_BIN"`.
  2. Inspect text rendering across header, prompts, and dialogs.
* **Expected:** System suppresses raw RGB ANSI sequences or falls back to monochrome/semantic bold styling. No broken ANSI escape codes (`\x1b[38;2;...m`) leak into visible text.
* **Cleanup:** Unset `NO_COLOR`.
* **Evidence / Limitations:** Theme color parsing in `packages/tui/src/theme/color.ts`.

---

## 2. BB Terminal Lifecycle & Resize Resilience

### UI-010: BB 1-minute idle reproduction and state capture
* **Priority:** High
* **Prerequisites:** Launch session in a BB agent environment / remote webview terminal (`https://...getbb.app`).
* **Steps:**
  1. Launch `$KILO_BIN` in BB terminal.
  2. Verify all UI components (header, tabs, sidebar, prompt) are clearly visible.
  3. Leave the session completely untouched for 1 minute (no keystrokes, no mouse movement, no process output).
  4. Inspect the viewport: record whether any elements disappear, blank out, or unmount.
  5. If blanked, type a single character without pressing Enter. Record whether typing restores the surface.
* **Expected:** UI state is captured for unrootcaused BB terminal behavior. If elements disappear, typing or event dispatch is monitored. Record exact visual state without claiming premature root-cause resolution.
* **Cleanup:** Exit session.
* **Evidence / Limitations:** Known issue: BB terminal element disappearance under idle; resize is reported to restore it.

### UI-011: BB 5-minute idle reproduction
* **Priority:** High
* **Prerequisites:** Same as UI-010.
* **Steps:**
  1. Launch session in BB terminal.
  2. Leave untouched for 5 minutes.
  3. Inspect screen. Note if cursor is active or if alternate buffer was cleared by host gateway/pty keepalive.
  4. Press `Shift` or a non-mutating modifier.
* **Expected:** Document whether terminal stream times out or detaches. Record whether background keepalive pings are received.
* **Cleanup:** Exit session.
* **Evidence / Limitations:** Parity with known bug notes in `plans/kilo-opencode-v2-test-plan.md`.

### UI-012: BB 15-minute extended idle reproduction
* **Priority:** Medium
* **Prerequisites:** Same as UI-010.
* **Steps:**
  1. Launch session in BB terminal.
  2. Leave untouched for 15 minutes.
  3. Inspect screen for full blanking or partial header/footer drop.
* **Expected:** Document state transitions. Record whether connection dropped or if TUI process is still alive in background.
* **Cleanup:** Exit session.
* **Evidence / Limitations:** Pure observational capture test.

### UI-013: Terminal window resize event restoration
* **Priority:** High
* **Prerequisites:** UI in an idle-blanked or partially degraded state from UI-010/011, or intentionally induced.
* **Steps:**
  1. With degraded or blanked UI, trigger a SIGWINCH window resize by dragging the terminal window border by 1 column/row.
  2. Observe whether the alternate screen redraws immediately.
* **Expected:** Resize event triggers full canvas re-render. All UI elements (header, tabs, status bar, prompt) are completely restored to screen.
* **Cleanup:** Restore original window size.
* **Evidence / Limitations:** Automated harness reference: `packages/tui/test/mini/stream-v2.transport.test.ts` ("preserves active text and reasoning across resize").

### UI-014: Terminal resize during active streaming response
* **Priority:** High
* **Prerequisites:** Session running with an active assistant generation (mocked or offline fixture stream).
* **Steps:**
  1. Submit a prompt that produces multi-line streaming text.
  2. While text is actively streaming onto the screen, rapidly resize the terminal window 3 times (e.g., 80x24 -> 120x30 -> 100x25).
  3. Wait for stream to finish.
* **Expected:** No crash or fatal panic. Active streaming text and reasoning blocks re-flow without duplicating deltas or losing lines. Output remains cohesive.
* **Cleanup:** Reset terminal if needed.
* **Evidence / Limitations:** Automated harness reference: `packages/tui/test/mini/stream-v2.transport.test.ts`.

---

## 3. Command Palette & Slash Command Deduplication

### UI-015: Slash command autocomplete list deduplication
* **Priority:** High
* **Prerequisites:** Clean interactive session in `$KILO_TEST_PROJECT`.
* **Steps:**
  1. In empty composer, type `/`.
  2. Inspect the popup autocomplete menu.
  3. Scroll through all listed slash commands.
* **Expected:** Every slash command appears exactly once. No command ID or display name is listed twice (e.g., `/settings` vs `/kilo-settings`, `/share`). Aliases (`/mem` for `/memory`, `/kilo-config` for `/kilo-settings`) resolve cleanly to their primary action.
* **Cleanup:** Press `Escape` to close menu.
* **Evidence / Limitations:** Autocomplete logic in `packages/tui/src/component/prompt/autocomplete.tsx`.

### UI-016: `/share` routing to Kilo public sharing confirmation
* **Priority:** High
* **Prerequisites:** Interactive session running. No real upload required (FIXTURE / CANCEL).
* **Steps:**
  1. Type `/share` and press Enter.
  2. Observe the resulting dialog modal.
  3. Verify modal title and warning text.
  4. Press `Escape` or select `cancel`.
* **Expected:** Opens "Share session publicly" confirmation dialog explaining transcript/tool upload to Kilo. It does NOT invoke native OpenCode upstream sharing or silently upload data. Selecting cancel aborts cleanly without network traffic.
* **Cleanup:** Dismiss dialog.
* **Evidence / Limitations:** Implemented in `packages/kilo-cli/src/tui-plugin/tui.tsx` (`session.share`) and tested in `packages/kilo-cli/test/sharing.test.tsx`.

### UI-017: `/unshare` command presentation and cancellation
* **Priority:** Medium
* **Prerequisites:** Interactive session.
* **Steps:**
  1. Type `/unshare` and press Enter.
  2. If session is not currently shared, observe notification/alert.
* **Expected:** If session was never shared, shows appropriate feedback ("Session is not shared" or error toast). No unhandled exception.
* **Cleanup:** Close toast.
* **Evidence / Limitations:** Defined in `packages/kilo-cli/src/tui-plugin/tui.tsx`.

### UI-018: `/settings` vs `/kilo-settings` distinct routing
* **Priority:** High
* **Prerequisites:** Interactive session.
* **Steps:**
  1. Type `/settings` and press Enter. Observe opened dialog. Close it.
  2. Type `/kilo-settings` (or `/kilo-config`) and press Enter. Observe opened dialog.
* **Expected:** `/settings` opens the native upstream TUI presentation/behavior settings dialog (`DialogConfig`). `/kilo-settings` opens Kilo-specific configuration dialog (`installSettingsUi`) managing profile/project scopes. They are completely distinct dialogs.
* **Cleanup:** Press `Escape` to dismiss dialog.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/settings.tsx` and tested in `packages/kilo-cli/test/settings-ui.test.tsx`.

### UI-019: `/privacy` slash command argument parsing
* **Priority:** Medium
* **Prerequisites:** Interactive session.
* **Steps:**
  1. Type `/privacy` without arguments and press Enter.
  2. Type `/privacy invalid` and press Enter.
* **Expected:** Shows usage toast: "Run /privacy on or /privacy off." No state change occurs.
* **Cleanup:** Dismiss toast.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/privacy.test.ts`.

### UI-020: `/memory` slash command argument dispatch
* **Priority:** Medium
* **Prerequisites:** Interactive session with local memory RPC available.
* **Steps:**
  1. Type `/memory` (or `/mem`) without arguments and press Enter.
  2. Verify it opens the Memory modal dialog (`show`).
  3. Press `Escape`, then type `/memory help` and press Enter.
* **Expected:** `/memory` opens the main memory browser dialog. `/memory help` opens the memory usage overview modal.
* **Cleanup:** Close dialog.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/memory.tsx` and tested in `packages/kilo-cli/test/memory-ui.test.tsx`.

### UI-021: `/teams` organization selection modal entry
* **Priority:** Medium
* **Prerequisites:** Interactive session. Privacy mode OFF.
* **Steps:**
  1. Type `/teams` (or `/team`, `/org`) and press Enter.
  2. Observe dialog presentation.
* **Expected:** If unauthenticated, displays prompt to authenticate or alert that Gateway account is required. If authenticated, lists available organizations.
* **Cleanup:** Press `Escape` to exit dialog.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/teams.test.tsx`.

### UI-022: Command palette (`Ctrl+P`) discovery and keyboard filtering
* **Priority:** Medium
* **Prerequisites:** Interactive session.
* **Steps:**
  1. Press `Ctrl+P` to open command palette.
  2. Type `kilo`.
  3. Verify filtered command list.
* **Expected:** Shows all Kilo-registered commands (e.g., `Kilo settings`, `Kilo memory`, `Share session publicly`). Arrow keys navigate; `Enter` executes; `Escape` closes.
* **Cleanup:** Press `Escape`.
* **Evidence / Limitations:** Automated harness reference: `packages/tui/test/cli/tui/command-palette.test.tsx`.

---

## 4. Model Picker Presentation, Groups, Filtering & Privacy

### UI-023: Model picker first-open loading state
* **Priority:** High
* **Prerequisites:** Interactive session with slow/mocked metadata latency.
* **Steps:**
  1. Open model picker (`/models` or click model in status bar).
  2. Observe dialog content immediately before network RPC resolves.
* **Expected:** Dialog renders centered placeholder: "Loading Kilo model metadata…". Options list is locked; filter input is suppressed while loading. No flash of empty or unstyled elements.
* **Cleanup:** Allow RPC to complete or press `Escape`.
* **Evidence / Limitations:** Handled in `packages/tui/src/component/dialog-model.tsx` (lines 228-235) and tested in `packages/kilo-cli/test/model-picker-ui.test.tsx`.

### UI-024: Model picker grouping: "Kilo Auto" and "Recommended"
* **Priority:** High
* **Prerequisites:** Mocked or real catalog returning Auto IDs (`kilo-auto/free`, etc.) and models with `recommendedIndex`.
* **Steps:**
  1. Open model dialog `/models`.
  2. Inspect category section headers in the list.
* **Expected:** Models are grouped into categories: "Favorites" (if any), "Recent" (if any), "Kilo Auto", and "Recommended". "Kilo Auto" appears first among catalog groups, ordered by recommendation index.
* **Cleanup:** Close dialog.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/model-picker.test.ts` (lines 6-22).

### UI-025: Known Kilo Auto IDs classification without metadata
* **Priority:** Medium
* **Prerequisites:** Catalog metadata omitting explicit `recommendedIndex` for `kilo-auto/efficient` and `auto-small`.
* **Steps:**
  1. Open model picker.
  2. Locate `kilo-auto/efficient` or `auto-small`.
* **Expected:** Known Auto IDs are grouped under "Kilo Auto" by ID heuristic (`isKiloAutoID`), even if server catalog metadata omits explicit recommendation rankings.
* **Cleanup:** Close dialog.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/model-picker.test.ts` (lines 24-38).

### UI-026: Auto routing metadata does NOT classify regular models as Auto
* **Priority:** Medium
* **Prerequisites:** Model entry with `autoRouting: { models: [...] }` but ID `regular-model`.
* **Steps:**
  1. Inject/mock catalog with `regular-model` containing routing metadata.
  2. Open model picker.
* **Expected:** `regular-model` is NOT classified under "Kilo Auto". It remains in its standard provider category or "Recommended" (if indexed).
* **Cleanup:** Close dialog.
* **Evidence / Limitations:** Verified in `packages/kilo-cli/src/model-picker.ts` (lines 53-54).

### UI-027: Model metadata fetch failure and fallback banner
* **Priority:** High
* **Prerequisites:** Simulate network timeout or failure on `KiloModels.Definition.list` RPC.
* **Steps:**
  1. Trigger model picker when RPC server endpoint returns 500 or network drops.
  2. Observe model picker dialog presentation.
* **Expected:** Picker switches to `groupState = "fallback"`. Displays warning footer: "Could not load Kilo model metadata; showing available models." Available local/cached models remain selectable.
* **Cleanup:** Close dialog.
* **Evidence / Limitations:** Handled in `packages/tui/src/component/dialog-model.tsx` (lines 237-241).

### UI-028: Fast cancel and reopen of model picker (AbortSignal cleanup)
* **Priority:** Medium
* **Prerequisites:** Interactive session.
* **Steps:**
  1. Press `Ctrl+P` -> `/models` -> immediately press `Escape` within 50ms.
  2. Immediately reopen `/models`.
* **Expected:** AbortController cancels the first in-flight metadata promise (`controller.abort()`). Reopened dialog initiates a clean fresh fetch without race conditions, stale state, or memory leaks.
* **Cleanup:** Close dialog.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/model-picker.test.ts` (lines 95-130).

### UI-029: Personal vs Team account credit context in model selection
* **Priority:** Medium
* **Prerequisites:** Authenticated Gateway profile with both personal and team organizations.
* **Steps:**
  1. Switch organization to a Team account via `/teams`.
  2. Open `/models` and inspect footer disclosures and credit implications.
  3. Switch back to Personal account.
* **Expected:** Model dialog correctly reflects team vs personal context. If team policies restrict BYOK or certain providers, unpermitted models are disabled or hidden.
* **Cleanup:** Revert to standard organization.
* **Evidence / Limitations:** Tested via `packages/kilo-cli/src/model-picker.ts`.

### UI-030: Favorite models toggle and ordering
* **Priority:** Medium
* **Prerequisites:** Interactive session connected.
* **Steps:**
  1. Open `/models`.
  2. Highlight a model and trigger "Favorite" action (via action key or hotkey).
  3. Close dialog and reopen `/models`.
* **Expected:** Favorited model now appears in the top "Favorites" category section with "(Favorite)" marker. It is given priority in search filtering.
* **Cleanup:** Unfavorite model to restore initial state.
* **Evidence / Limitations:** Implemented in `packages/tui/src/component/dialog-model.tsx` (lines 214-221, 250-256).

### UI-031: Favorite persistence across session restarts
* **Priority:** Medium
* **Prerequisites:** Favorite a model in UI-030.
* **Steps:**
  1. Exit Kilo session (`/exit`).
  2. Relaunch `$KILO_BIN`.
  3. Open `/models`.
* **Expected:** Favorited model remains pinned under "Favorites" across client restart.
* **Cleanup:** Unfavorite model.
* **Evidence / Limitations:** Stored in local TUI storage under `modelPreferenceKey`.

### UI-032: Prompt training filter enabled: hides `mayTrainOnYourPrompts` models
* **Priority:** High
* **Prerequisites:** Set `hide_prompt_training_models: true` in project or profile config. Catalog includes models with `mayTrainOnYourPrompts: true`.
* **Steps:**
  1. Open `/models`.
  2. Search for the model known to have `mayTrainOnYourPrompts: true`.
* **Expected:** The model is completely omitted from the options list, favorites, and recent lists (`hidden: true`). It cannot be selected while the privacy filter is active.
* **Cleanup:** Revert setting to `false`.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/model-picker.test.ts` (lines 71-93).

### UI-033: Prompt training filter disabled: displays "May train" disclosure
* **Priority:** High
* **Prerequisites:** `hide_prompt_training_models: false`.
* **Steps:**
  1. Open `/models`.
  2. Locate a model with `mayTrainOnYourPrompts: true`.
* **Expected:** The model is visible and selectable. Its footer disclosure explicitly displays "May train" (along with "BYOK" or "Free" if applicable).
* **Cleanup:** None.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/src/model-picker.ts` (lines 43-50).

### UI-034: Fuzzy search filtering across titles and categories
* **Priority:** Low
* **Prerequisites:** Open `/models`.
* **Steps:**
  1. Type `claude son` in the filter input.
  2. Inspect result list.
* **Expected:** Fuzzysort matches titles and categories accurately. Favorited matching items sort above non-favorited matching items (`prioritizeFavorites`).
* **Cleanup:** Clear search input.
* **Evidence / Limitations:** Implemented in `packages/tui/src/component/dialog-model.tsx` (lines 162-167).

---

## 5. Agent Selection, Ask/Debug Boundaries & Custom Agents

### UI-035: Native `build` agent displayed as "Code"
* **Priority:** High
* **Prerequisites:** Interactive session running with default agent configuration.
* **Steps:**
  1. Open agent selector (`/agents`).
  2. Inspect the primary coding agent.
* **Expected:** The agent with underlying ID `build` is displayed with name "Code". No agent is listed with the display name "Build".
* **Cleanup:** Close dialog.
* **Evidence / Limitations:** Renamed in `packages/kilo-cli/src/agent-policy.ts` (line 41).

### UI-036: Ask mode read-only system prompt and tool boundaries
* **Priority:** High
* **Prerequisites:** Session running. Switch agent to "Ask" via `/agents`.
* **Steps:**
  1. Verify status bar displays active agent "Ask".
  2. Prompt the agent: "Refactor index.ts to add a function".
  3. Inspect tools available to the model and output behavior.
* **Expected:** Agent system prompt enforces read-only mode ("You are in Ask mode — a read-only assistant..."). Tools `edit`, `shell`, and `subagent` are strictly denied by permission policy. Model provides text explanation without mutating files or running shell commands.
* **Cleanup:** Switch back to Code agent.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/agent-policy.test.ts` (lines 24-34).

### UI-037: Ask mode env file read confirmation (`ask` effect)
* **Priority:** High
* **Prerequisites:** Workspace containing `.env` and `.env.example`. Active agent is "Ask".
* **Steps:**
  1. Ask agent: "Read .env and .env.example".
  2. Observe permission interaction.
* **Expected:** Reading `.env.example` is allowed automatically. Reading `.env` or `.env.local` triggers an interactive user confirmation prompt (`effect: "ask"`). Denying prevents the read; allowing proceeds.
* **Cleanup:** Close session.
* **Evidence / Limitations:** Defined in `packages/kilo-cli/src/agent-policy.ts` (lines 54-56).

### UI-038: Debug agent systematic diagnosis workflow
* **Priority:** Medium
* **Prerequisites:** Switch agent to "Debug" via `/agents`.
* **Steps:**
  1. Prompt: "Diagnose why the test suite fails".
  2. Observe reasoning style.
* **Expected:** Debug agent follows systematic prompt guidelines: reflects on 5-7 potential sources, narrows down to 1-2, adds diagnostic logging/investigation before proposing minimal targeted fixes.
* **Cleanup:** Switch back to Code.
* **Evidence / Limitations:** Prompt defined in `packages/kilo-cli/src/agent-policy.ts` (lines 21-28).

### UI-039: Custom project agent declaration in `kilo.jsonc`
* **Priority:** High
* **Prerequisites:** Project configuration file `$KILO_TEST_PROJECT/.kilo/kilo.jsonc` defining custom agent:
  ```jsonc
  {
    "agents": {
      "security-auditor": {
        "description": "Scans for vulnerabilities",
        "mode": "primary",
        "system": "Audit code for security flaws."
      }
    }
  }
  ```
* **Steps:**
  1. Launch Kilo CLI pointing to project.
  2. Open `/agents`.
* **Expected:** `security-auditor` is listed as a selectable primary agent with its custom description. Selecting it activates the agent with the specified system prompt.
* **Cleanup:** Remove custom agent from config.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/agent-policy.test.ts` (lines 41-70).

### UI-040: Project custom agent overriding built-in `ask`
* **Priority:** High
* **Prerequisites:** Project config defining `agents: { ask: { description: "Custom Ask", system: "Custom ask prompt" } }`.
* **Steps:**
  1. Launch Kilo CLI.
  2. Inspect `/agents` and select "Ask".
* **Expected:** User-defined Ask agent takes precedence. Kilo post-policy does NOT overwrite the user's custom prompt, description, or permissions (`if (!editor.get("ask")) return`).
* **Cleanup:** Revert config.
* **Evidence / Limitations:** Verified in `packages/kilo-cli/src/agent-policy.ts` (line 45).

### UI-041: Agent switching via composer slash command
* **Priority:** Medium
* **Prerequisites:** Session running.
* **Steps:**
  1. Type `/agents ask` or use `/agents` dialog to pick Ask.
  2. Inspect status bar.
  3. Type `/agents code` to switch back.
* **Expected:** Active agent switches cleanly. Status bar updates agent tag immediately. Subsequent prompts execute under the newly selected agent's permissions.
* **Cleanup:** Ensure default Code agent is restored.
* **Evidence / Limitations:** Agent switching handled by TUI runtime.

### UI-042: Subagent delegation denial in Ask and Plan modes
* **Priority:** High
* **Prerequisites:** Session in Ask or Plan mode.
* **Steps:**
  1. Attempt to invoke a subagent task via prompt or mock tool call.
* **Expected:** Permission evaluation rejects `subagent` action with `effect: "deny"`. Subagents cannot be spawned by read-only Ask or Plan agents.
* **Cleanup:** Return to Code mode.
* **Evidence / Limitations:** Policy in `packages/kilo-cli/src/agent-policy.ts` (line 66) and `plan-policy.ts` (line 75).

---

## 6. Plan Mode Workflow, Save Consent & Completion Gates

### UI-043: Plan agent startup and read-only status
* **Priority:** High
* **Prerequisites:** Interactive session. Switch agent to "Plan" via `/agents`.
* **Steps:**
  1. Observe status bar showing "Plan".
  2. Ask Plan agent to inspect codebase files.
* **Expected:** Agent can read files (`read`, `grep`, `glob`), but all mutations outside `.kilo/plans/*.md` and all shell commands are strictly denied.
* **Cleanup:** Switch back to Code agent.
* **Evidence / Limitations:** Permissions in `packages/kilo-cli/src/plan-policy.ts` (lines 54-75).

### UI-044: Save-permission regression check: absent `.kilo/plans` directory
* **Priority:** Critical
* **Prerequisites:** Clean project workspace where `.kilo/plans` directory does **NOT** exist initially.
* **Steps:**
  1. Launch Kilo in Plan mode.
  2. Ask Plan agent to finalize a plan.
  3. Model attempts to call `write` or `edit` on `.kilo/plans/feature-plan.md` or calls `plan_exit` before directory creation.
* **Expected:** Permission evaluation for `.kilo/plans/*.md` is Location-relative and allows writing under `.kilo/plans/`. However, `plan_exit` validates that `.kilo/plans` is an existing real directory within the project. If missing, it fails with: `"Plan directory does not exist yet; save the plan under .kilo/plans before calling plan_exit"`. Directory must be created properly before `plan_exit` succeeds.
* **Cleanup:** Remove `.kilo/plans/` directory if created.
* **Evidence / Limitations:** Critical regression test from recent session fix (`packages/kilo-cli/src/plan-policy.ts` lines 197-210, `packages/kilo-cli/test/plan-policy.test.ts`).

### UI-045: Prompt-directed Save question form ("Finalize and save the plan")
* **Priority:** High
* **Prerequisites:** Active Plan session. Model has generated a complete proposal.
* **Steps:**
  1. Prompt: "The plan looks solid, please finalize it."
  2. Observe tool call.
* **Expected:** Model invokes the native `question` tool with choices: "Finalize and save the plan" vs "Continue refining". A visual selection form appears in the TUI titled "Questions" or "Save plan".
* **Cleanup:** Dismiss form.
* **Evidence / Limitations:** Known limitation: Save question is prompt-directed by system instructions, not a hardcoded deterministic model intercept (`packages/kilo-cli/src/plan-prompt.txt` lines 23-25).

### UI-046: User chooses "Continue refining" in Save question form
* **Priority:** High
* **Prerequisites:** Save question form active from UI-045.
* **Steps:**
  1. Select option: "Continue refining".
  2. Submit form.
* **Expected:** Plan file is **NOT** written to disk. Session remains in Plan mode. Model responds acknowledging that planning continues and asks the next clarifying question.
* **Cleanup:** Close session.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 121-154).

### UI-047: User chooses "Finalize and save the plan"
* **Priority:** High
* **Prerequisites:** Save question form active.
* **Steps:**
  1. Select option: "Finalize and save the plan".
  2. Submit form.
* **Expected:** Model executes `write` tool to create `.kilo/plans/<plan-name>.md`. File is actually written to the filesystem. Model then proceeds to call `plan_exit`.
* **Cleanup:** Inspect written plan file and delete it.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 50-84).

### UI-048: Plan exit completion choice modal presentation
* **Priority:** High
* **Prerequisites:** Plan file written to `.kilo/plans/test-plan.md`. Model calls `plan_exit(path: ".kilo/plans/test-plan.md")`.
* **Steps:**
  1. Observe TUI when `plan_exit` executes.
* **Expected:** Native question tool renders an interactive completion form titled "Ready to implement?" offering exactly 3 choices:
  - "Start new session" (Implement in a fresh session with a clean context)
  - "Continue here" (Implement the plan in this session)
  - "Keep refining" (Keep planning without implementing yet)
* **Cleanup:** Dismiss or answer form.
* **Evidence / Limitations:** Defined in `packages/kilo-cli/src/plan-policy.ts` (lines 105-125).

### UI-049: Completion choice: "Continue here" switches to Code agent
* **Priority:** High
* **Prerequisites:** Completion form displayed from UI-048.
* **Steps:**
  1. Select "Continue here" and submit.
* **Expected:** Session agent immediately transitions from "plan" to "build" ("Code"). Implementation prompt is enqueued as a steer: `"Implement the approved plan at .kilo/plans/test-plan.md"`. Session begins implementation in the current context.
* **Cleanup:** Cancel execution (`Escape`). Delete plan file.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 43-47, 147-155).

### UI-050: Completion choice: "Start new session" forks clean context
* **Priority:** High
* **Prerequisites:** Completion form displayed from UI-048.
* **Steps:**
  1. Select "Start new session" and submit.
* **Expected:** A brand-new session is created with the Code agent (`build`) adopting the active model. Original planning session remains intact. Steer prompt initiates implementation in the new session.
* **Cleanup:** Close both sessions. Delete plan file.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 305-327).

### UI-051: Completion choice: "Keep refining" keeps Plan mode active
* **Priority:** High
* **Prerequisites:** Completion form displayed from UI-048.
* **Steps:**
  1. Select "Keep refining" and submit.
* **Expected:** Session stays in Plan mode. No agent switch occurs. Implementation prompt is NOT enqueued.
* **Cleanup:** Close session. Delete plan file.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 329-347).

### UI-052: Rejection of free-form completion answers
* **Priority:** Medium
* **Prerequisites:** Model attempts to submit an arbitrary string answer to the completion form (or user bypass).
* **Steps:**
  1. Simulate or supply answer `"Implement everything now"` instead of the 3 listed options.
* **Expected:** `plan_exit` fails with Tool.Error: `"Plan implementation requires one of the listed completion choices; this plan remains in Plan mode"`. Session does NOT leave Plan mode.
* **Cleanup:** Dismiss error.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 349-367).

### UI-053: `plan_exit` called with missing plan file on disk
* **Priority:** High
* **Prerequisites:** Model calls `plan_exit` for `.kilo/plans/nonexistent.md` without having written it.
* **Steps:**
  1. Execute tool call `plan_exit(path: ".kilo/plans/nonexistent.md")`.
* **Expected:** Tool execution fails with error: `"Plan file does not exist yet; save the plan to .kilo/plans/nonexistent.md before calling plan_exit"`. No completion dialog opens.
* **Cleanup:** None.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 156-175).

### UI-054: `plan_exit` called with invalid path outside `.kilo/plans`
* **Priority:** High
* **Prerequisites:** Plan mode session.
* **Steps:**
  1. Model attempts `plan_exit(path: "src/plan.md")` or `plan_exit(path: "../plan.md")`.
* **Expected:** Validation rejects path: `"Plan file must be under this project's .kilo/plans directory"`. Non-markdown files (`.txt`) are rejected with `"Plan file must be a Markdown file"`.
* **Cleanup:** None.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 397-416).

### UI-055: Global edit deny takes precedence over Plan save allowance
* **Priority:** High
* **Prerequisites:** Project configuration specifies global deny: `permissions: [{ action: "edit", resource: "*", effect: "deny" }]`.
* **Steps:**
  1. In Plan mode, attempt to write `.kilo/plans/plan.md`.
* **Expected:** Global edit deny wins. Write is blocked with permission denied. Plan cannot be saved.
* **Cleanup:** Remove global deny from config.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/plan-policy.test.ts` (lines 207-241).

### UI-056: Plan mode resume from previous session
* **Priority:** Medium
* **Prerequisites:** Previous session ended in Plan mode.
* **Steps:**
  1. Relaunch Kilo and resume the previous Plan session via `/sessions`.
  2. Inspect active agent and prompt permissions.
* **Expected:** Resumed session retains Plan agent, read-only permissions, and access to saved plans under `.kilo/plans/`.
* **Cleanup:** Close session.
* **Evidence / Limitations:** Session state persistence across restarts.

---

## 7. Kilo Settings UI Scopes, Precedence & Validation

### UI-057: Settings scope selection: Profile vs Project
* **Priority:** High
* **Prerequisites:** Interactive session running in `$KILO_TEST_PROJECT`.
* **Steps:**
  1. Run command `/kilo-settings` (or `/kilo-config`).
  2. Inspect scope selection dialog.
* **Expected:** Dialog prompts: "Select a configuration scope" with two options:
  - "Profile" (Edits `$XDG_CONFIG_HOME/kilo2/interactive/kilo.jsonc`)
  - "Project" (Edits `$KILO_TEST_PROJECT/.kilo/kilo.jsonc`)
  Each shows whether the target file exists or will be created.
* **Cleanup:** Press `Escape` to close.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/settings.tsx` (lines 69-80) and tested in `packages/kilo-cli/test/settings-ui.test.tsx`.

### UI-058: Unwritable project scope handling
* **Priority:** Medium
* **Prerequisites:** Workspace project directory made read-only (`chmod 555 "$KILO_TEST_PROJECT"`).
* **Steps:**
  1. Open `/kilo-settings`.
  2. Select "Project" scope.
* **Expected:** Option remains selectable (not hidden), but selecting it triggers an alert dialog explaining that the project configuration target is not writable (`selected.reason`).
* **Cleanup:** Restore write permissions (`chmod 755 "$KILO_TEST_PROJECT"`).
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/settings.tsx` (lines 81-88).

### UI-059: Field list navigation and value descriptions
* **Priority:** Medium
* **Prerequisites:** Open `/kilo-settings` -> select "Profile" scope.
* **Steps:**
  1. Inspect the displayed settings fields list.
  2. Inspect the description column for each item.
* **Expected:** Fields display current profile value, project value (if writable), and which scope currently applies (e.g., `applies: profile` or `applies: project`).
* **Cleanup:** Press `Escape`.
* **Evidence / Limitations:** Verified via `packages/kilo-cli/src/tui-plugin/settings.tsx` (lines 178-186).

### UI-060: Edit boolean field: Enable, Disable, Unset
* **Priority:** High
* **Prerequisites:** Open `/kilo-settings` -> "Profile" -> select a boolean setting (e.g., `hide_prompt_training_models`).
* **Steps:**
  1. Inspect choices dialog.
  2. Select "Enabled" and press Enter.
  3. Reopen setting, select "Unset", and press Enter.
* **Expected:** Displays "Enabled", "Disabled", and "Unset" (removes key from scope). Selecting "Enabled" persists `true` in `kilo.jsonc`. Selecting "Unset" cleanly removes the property without leaving null or undefined. Success toast appears.
* **Cleanup:** Verify `kilo.jsonc` clean state.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/settings.tsx` (lines 128-144).

### UI-061: Edit integer field with validation boundary
* **Priority:** Medium
* **Prerequisites:** Open `/kilo-settings` -> select an integer setting with minimum constraint.
* **Steps:**
  1. Enter text: `not-a-number`.
  2. Observe toast.
  3. Enter number below minimum (e.g., `0` when minimum is `1`).
  4. Enter valid number (e.g., `5`).
* **Expected:** Non-integers and numbers below minimum trigger an error toast ("Enter a whole number of at least ...") without submitting. Valid number updates config successfully.
* **Cleanup:** Revert setting.
* **Evidence / Limitations:** Enforced in `packages/kilo-cli/src/tui-plugin/settings.tsx` (lines 154-160).

### UI-062: JSONC comment and formatting preservation on write
* **Priority:** High
* **Prerequisites:** Existing `kilo.jsonc` containing inline comments (`// user note`) and custom indentation.
* **Steps:**
  1. Change a setting via `/kilo-settings`.
  2. Inspect `kilo.jsonc` on disk using file reader.
* **Expected:** Modifying the setting uses `jsonc-parser` modify API. Surrounding comments and indentation are preserved intact; file is not reformatted into raw stripped JSON.
* **Cleanup:** Restore original file.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/src/privacy-settings.ts` modify routines and `packages/kilo-cli/test/settings.test.ts`.

### UI-063: Concurrent stale edits rejection (`expected` revision guard)
* **Priority:** High
* **Prerequisites:** Two open sessions or external process modifying `kilo.jsonc` simultaneously.
* **Steps:**
  1. Open `/kilo-settings` in session A (reads snapshot revision).
  2. In external shell, write a change directly to `kilo.jsonc`.
  3. In session A, attempt to commit a settings change.
* **Expected:** Mutation fails or detects stale revision guard (`expected: selected.expected`), presenting an alert: configuration changed on disk; prompts user to reload. Stale in-memory value does not blindly clobber disk edits.
* **Cleanup:** Reload settings.
* **Evidence / Limitations:** Guarded by `packages/kilo-cli/src/settings-rpc.ts`.

### UI-064: Ancestor project config discovery and inheritance
* **Priority:** Medium
* **Prerequisites:** Workspace nested inside a monorepo root containing `.kilo/kilo.jsonc`.
* **Steps:**
  1. Launch Kilo from sub-package directory.
  2. Open `/kilo-settings` -> inspect active settings.
* **Expected:** Settings correctly discover and inherit from the canonical project boundary root. Project settings display values inherited from ancestor root config.
* **Cleanup:** None.
* **Evidence / Limitations:** Project boundary resolution in `packages/kilo-cli/src/paths.ts`.

### UI-065: Invalid JSONC syntax in config file on disk
* **Priority:** Medium
* **Prerequisites:** Manually introduce a syntax error in `.kilo/kilo.jsonc` (e.g., trailing dangling comma or unclosed brace).
* **Steps:**
  1. Launch Kilo and run `/kilo-settings`.
* **Expected:** Alert dialog explains that the configuration file contains invalid JSON/syntax errors and cannot be parsed safely. App does not crash.
* **Cleanup:** Fix syntax error in `kilo.jsonc`.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/settings-rpc.ts`.

### UI-066: Wrong-type value in config file (e.g., string instead of boolean)
* **Priority:** Medium
* **Prerequisites:** Manually write `"{ \"hide_prompt_training_models\": \"true\" }"` (string) in config.
* **Steps:**
  1. Launch Kilo and open `/kilo-settings`.
  2. Inspect the field description.
* **Expected:** Field displays an `invalid` notice marker in the list (e.g., `invalid: expected boolean`). User can overwrite it with a valid boolean selection.
* **Cleanup:** Revert config.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/settings.tsx` (line 184).

---

## 8. Memory UI: Compact Sidebar, Dialog & Toggle Controls

### UI-067: Compact sidebar memory status row: "Enabled" (neutral tone)
* **Priority:** High
* **Prerequisites:** Interactive session running with memory enabled in project.
* **Steps:**
  1. Inspect the sidebar "Memory" section.
  2. Observe the status dot bullet and text label.
* **Expected:** Displays bullet `•` and text label `Enabled` in muted subdued tone (`theme.text.subdued`). **Limitation note:** Historical v1 active/save 5-second pulse is NOT implemented in v2; Enabled honestly stays neutral/muted.
* **Cleanup:** None.
* **Evidence / Limitations:** Implemented in `packages/kilo-cli/src/tui-plugin/sidebar-memory.tsx` (lines 17-29, 125-134) and tested in `packages/kilo-cli/test/sidebar-memory.test.tsx`.

### UI-068: Compact sidebar memory status row: "Disabled"
* **Priority:** High
* **Prerequisites:** Memory disabled for project (run `/memory disable`).
* **Steps:**
  1. Inspect the sidebar Memory row.
* **Expected:** Status bullet renders subdued and label displays `Disabled`.
* **Cleanup:** Re-enable memory via `/memory enable`.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/sidebar-memory.tsx` (line 27).

### UI-069: Compact sidebar memory status row: "Unavailable" / Error tone
* **Priority:** Medium
* **Prerequisites:** Memory RPC client disconnected or server endpoint error injected.
* **Steps:**
  1. Disconnect or fail the memory RPC.
  2. Inspect sidebar.
* **Expected:** Status bullet renders in error feedback color (`theme.text.feedback.error.default`) and label displays `Unavailable`.
* **Cleanup:** Restore RPC.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/sidebar-memory.tsx` (line 130).

### UI-070: Memory full modal dialog (`/memory show` or `/memory`)
* **Priority:** High
* **Prerequisites:** Memory enabled with saved project memories.
* **Steps:**
  1. Run command `/memory show`.
  2. Inspect the modal dialog.
* **Expected:** Opens full memory browser dialog displaying stored memory records (decisions, constraints, project notes). Up/Down arrows scroll entries; `Escape` closes dialog.
* **Cleanup:** Close dialog.
* **Evidence / Limitations:** Implemented in `packages/kilo-cli/src/tui-plugin/memory-dialog.tsx` and tested in `packages/kilo-cli/test/memory-ui.test.tsx`.

### UI-071: Memory toggle commands: `/memory enable` and `/memory disable`
* **Priority:** High
* **Prerequisites:** Interactive session running.
* **Steps:**
  1. Run `/memory disable`. Observe toast and sidebar.
  2. Run `/memory enable`. Observe toast and sidebar.
* **Expected:** `/memory disable` displays toast "Memory disabled." Sidebar updates to `Disabled` immediately. `/memory enable` displays toast "Memory enabled." Sidebar updates to `Enabled`. State is persisted in project storage.
* **Cleanup:** Ensure memory is left in desired state.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/memory.test.ts`.

### UI-072: Memory automatic consolidation toggle: `/memory auto on|off`
* **Priority:** Medium
* **Prerequisites:** Interactive session.
* **Steps:**
  1. Run `/memory auto on`. Observe toast.
  2. Run `/memory auto off`. Observe toast.
* **Expected:** Toasts display "Automatic consolidation enabled." and "Automatic consolidation disabled." respectively.
* **Cleanup:** None.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/memory.tsx` (lines 83-91).

### UI-073: Multi-project memory boundary isolation across project switch
* **Priority:** High
* **Prerequisites:** Two separate projects: Project A with memory A, Project B with memory B.
* **Steps:**
  1. Launch session in Project A. Open `/memory show` and verify memory A is shown.
  2. Switch project location via `/open` or launch session in Project B.
  3. Open `/memory show` in Project B.
* **Expected:** Project B shows strictly memory B records. Memories from Project A are completely invisible in Project B. No cross-project memory leakage.
* **Cleanup:** None.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/memory.test.ts` (project isolation tests).

### UI-074: Memory manual remember and forget from command palette
* **Priority:** Medium
* **Prerequisites:** Interactive session with memory enabled.
* **Steps:**
  1. Run command palette -> `Kilo memory: remember`. Enter test memory note.
  2. Verify toast confirmation.
  3. Open `/memory show` to verify entry appears.
  4. Run `Kilo memory: forget` targeting the test key.
* **Expected:** Memory is saved cleanly and subsequent forget removes the record from persisted storage.
* **Cleanup:** Verify test memory is removed.
* **Evidence / Limitations:** Handled via memory RPC dispatch.

---

## 9. Sidebar Truthfulness: Credits, Indexing & Usage

### UI-075: Credits sidebar row: Signed-out state
* **Priority:** High
* **Prerequisites:** Launch session without Kilo Gateway authentication (no token / signed out).
* **Steps:**
  1. Inspect the "Credits" section in the active session sidebar.
* **Expected:** Displays header `Credits` with subdued text: `Sign in to view credits`. Does not display fictitious balances ($0.00 or null).
* **Cleanup:** None.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/src/tui-plugin/sidebar-account.tsx` (lines 130-132) and `packages/kilo-cli/test/sidebar-account.test.tsx`.

### UI-076: Credits sidebar row: Personal credits and Kilo Pass display
* **Priority:** High
* **Prerequisites:** Authenticated Personal Gateway account with active balance and Kilo Pass. Privacy mode OFF. [USER-OPT-IN or FIXTURE]
* **Steps:**
  1. Inspect sidebar Credits section.
* **Expected:** Displays `Personal credits` with formatted currency (e.g., `$25.40`). Displays breakdown rows:
  - `└ Kilo Pass` with usage / base credits (e.g., `$12.00 / $50.00`)
  - `Bonus` if positive bonus credits exist
  - `Renews` with formatted month/day (e.g., `Oct 1`)
* **Cleanup:** None.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/src/tui-plugin/sidebar-account.tsx` (lines 143-181) and `packages/kilo-cli/test/sidebar-account-ui.test.tsx`.

### UI-077: Credits sidebar row: Privacy mode masking (`/privacy on`)
* **Priority:** High
* **Prerequisites:** Authenticated account with credits visible from UI-076.
* **Steps:**
  1. Run command `/privacy on`.
  2. Inspect sidebar Credits row.
* **Expected:** Credit label shifts to generic "Personal credits" or "Team credits" without organization name. Balance value is masked with `•••`. Kilo Pass breakdown is completely hidden.
* **Cleanup:** Run `/privacy off`.
* **Evidence / Limitations:** Automated harness reference: `packages/kilo-cli/test/privacy-ui.test.tsx`.

### UI-078: Codebase indexing sidebar row: "Disabled", "In Progress", "Complete"
* **Priority:** High
* **Prerequisites:** Session launched with or without `--indexing-config`.
* **Steps:**
  1. Launch without indexing config: inspect sidebar "Code Indexing".
  2. Launch with indexing config during initial scan: inspect sidebar.
  3. Allow scan to complete: inspect sidebar.
* **Expected:**
  - Disabled: Displays `Code Indexing` with subdued label `Disabled` (or `Unavailable` if RPC not wired).
  - In Progress: Displays progress: `X / Y files (Z%)` with subdued status `In Progress`.
  - Complete: Displays success feedback green label `Complete`.
* **Cleanup:** None.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/sidebar-indexing.tsx` (lines 55-70) and tested in `packages/kilo-cli/test/sidebar-indexing-ui.test.tsx`.

### UI-079: Session usage sidebar row: Token breakdown and cost
* **Priority:** Medium
* **Prerequisites:** Session with executed prompt turns. Privacy mode OFF.
* **Steps:**
  1. Inspect sidebar "Usage" section.
* **Expected:** Displays token counts and estimated costs for the active session (input tokens, output tokens, cache read/write). Values reflect durable persisted usage without triggering fresh model requests.
* **Cleanup:** None.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/sidebar-usage.tsx` and tested in `packages/kilo-cli/test/sidebar-usage-ui.test.tsx`.

### UI-080: Session usage sidebar row: Privacy masking
* **Priority:** Medium
* **Prerequisites:** Session with usage displayed from UI-079.
* **Steps:**
  1. Run `/privacy on`.
  2. Inspect sidebar Usage section.
* **Expected:** Token counts and cost figures are masked or sanitized so sensitive session volume is obscured when presenting/sharing screen.
* **Cleanup:** Run `/privacy off`.
* **Evidence / Limitations:** Handled in `packages/kilo-cli/src/tui-plugin/sidebar-usage.tsx` (line 116).

---

## 10. Quick-Smoke Subset (~12 Essential IDs)

For rapid validation before full-suite manual or automated runs, execute this focused smoke subset:

1. **`UI-001`**: Clean interactive launch with default profile (no crash, clean alt screen).
2. **`UI-002`**: Kilo ASCII logo branding in splash and header.
3. **`UI-005`**: Narrow terminal layout (80 columns minimum constraint check).
4. **`UI-010`**: BB 1-minute idle reproduction and state capture.
5. **`UI-013`**: Terminal window resize event restoration (SIGWINCH redraw).
6. **`UI-015`**: Slash command autocomplete list deduplication.
7. **`UI-018`**: `/settings` (native) vs `/kilo-settings` (Kilo config) distinct routing.
8. **`UI-023`**: Model picker first-open loading state ("Loading Kilo model metadata…").
9. **`UI-035`**: Native `build` agent displayed as "Code".
10. **`UI-044`**: Save-permission regression check: absent `.kilo/plans` directory.
11. **`UI-047`**: Plan workflow: "Finalize and save the plan" real file write.
12. **`UI-057`**: Kilo settings scope selection: Profile vs Project dialog.
