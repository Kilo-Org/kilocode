# Agent Manager Side Terminal — Remaining Fixes

Prototype scope: one embedded terminal per context in the right-hand inspector, chosen via the
terminal button's dropdown. Multiple terminals in the panel are a later follow-up.

## Verified working (self-test, isolated VS Code)

- Dropdown lists both destinations with a check mark on the active one; default is VS Code terminal.
- Picking `Agent Manager panel` and clicking the terminal button spawns a real PTY beside the chat
  (`echo SIDE_TERMINAL_OK` returned its output in the panel).
- The toolbar button toggles: click hides (`am-side-host-hidden`, chat returns to full width), click
  again re-shows, xterm stays mounted the whole time so scrollback survives.
- Switching destinations back to `VS Code terminal` routes the button to the bottom integrated
  terminal again, so users can move between the new and legacy behavior at any time.

## Fix 1 — Drop the hide button, keep one destructive action

The panel header currently has both `chevron-right` (hide) and `close` (kill). The toolbar terminal
icon already *is* the hide affordance, so the chevron is redundant chrome.

- Remove the hide button from `SideTerminalPanel.tsx` and drop `onHide` from its props.
- Keep a single header action that kills the terminal, and switch its icon from `close` to `trash`,
  matching the delete affordance used in `WorktreeItem.tsx:316`.
- Label/tooltip becomes the existing delete-style wording rather than `common.close`.
- Remove the now-unused `agentManager.terminal.hide` key from all 20 locale files.

## Fix 2 — Return focus to the chat input when hiding

Reported flow: type instructions, `Cmd+/`, run a command, `Cmd+/` to minimize, keep typing in Agent
Manager. Today hiding blurs the terminal but leaves focus on `<body>`, so the next keystroke goes
nowhere.

- On hide, if the side terminal owned DOM focus, dispatch the existing `focusPrompt` window event
  (already consumed by the composer, see `AgentManagerApp.tsx:1149`) so the message input takes over.
- Gate it on the terminal actually having held focus (`terms.focusedId()` matching the side
  terminal). If the user was already typing in the chat, in the diff panel, or in another tab, hiding
  must not move focus at all.
- Same handoff when the terminal is killed from the header while focused.
- Cover the gate with a unit test so the "do not steal focus" half cannot regress.

## Fix 3 — Sane default width for the terminal panel

The panel inherits the diff panel's `50% of window` default, which squeezed the chat to ~270px in
the self-test. A terminal needs less room than a diff.

- Give terminal mode its own remembered width, defaulting to roughly a third of the window, clamped
  to `[360px, 640px]`; diff/PR keep their existing default and their own remembered width.
- Select width and minimum from the mode the host is currently showing (or last showed while a
  hidden terminal is still alive), so switching modes never resizes the other panel.

## Out of scope for this prototype

Multiple side terminals with their own tab strip inside the panel, persistence across Agent Manager
reopen, and splitting. The header layout leaves room for a `+` action when that lands.

## Manual re-check after the fixes

Trash icon kills the terminal and the panel closes; `Cmd+/` hide puts the cursor straight into the
message box; typing in the chat then pressing `Cmd+/` twice does not bounce focus unexpectedly;
default width leaves the chat readable; diff ↔ terminal switching keeps each panel's own width.
