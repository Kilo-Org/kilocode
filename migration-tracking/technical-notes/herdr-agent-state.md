# Herdr agent-state reporting

The Kilo v2 TUI reports the active session family's state to the Herdr pane that contains it. This integration does not add a server endpoint or change terminals outside Herdr.

## Activation

Launch Kilo inside a Herdr pane. Herdr supplies these variables; do not copy another pane's identity:

| Variable | Requirement |
|---|---|
| `HERDR_ENV` | Exactly `1` |
| `HERDR_PANE_ID` | The containing pane's ID |
| `HERDR_SOCKET_PATH` | The local Herdr socket path |

If any required variable is absent, the plugin does not connect or report. To test a checkout without touching an installed Kilo profile, run inside a new Herdr pane:

```sh
KILO_V2_PROFILE=$(mktemp -d) bun dev --standalone
```

## Reported states

The plugin samples the displayed session and its descendants once per second. It reports the root session ID, not the selected child's ID.

| State | Meaning |
|---|---|
| `blocked` | A permission request or form awaits input anywhere in the session family. Permissions take precedence over forms; the explanatory message is localized. |
| `working` | A family member is running or has non-synthetic pending input. |
| `idle` | Neither condition applies, or the TUI is on its home screen. |

Messages use the runtime locale reported by `Intl.DateTimeFormat`, with English as the fallback for unsupported locales. Non-English dictionaries are loaded only when the integration is active. Restart the TUI after changing the runtime locale.

Blocked state takes precedence over working state. Synthetic pending items alone do not indicate work. Identical reports are deduplicated; this is change reporting, not a heartbeat. A report counts as delivered only once Herdr replies on the socket. A connection error, early close or timeout leaves it undelivered, and the next tick sends the same state again. A state whose send is still in flight is not sent twice.

The OSC 7501 terminal status records (`packages/tui/src/context/program-status.ts`) are a separate channel. They identify the app through `OPENCODE_PROGRAM_STATUS_APP`, which the Kilo host sets to `kilo` (`packages/kilo-cli/src/env.ts`), with the upstream `opencode` default otherwise.

Requests are newline-delimited JSON using `pane.report_agent`, source and agent `kilo`, and increasing sequence numbers. When a session is active, reports also include `resume_argv` (`[<cli>, "--session", <rootSessionID>]`, using `OPENCODE_CLI_NAME`, which is `kilo2` during v2 development and flips to `kilo` on release) so Herdr 1 (0.9.2+) can restore the session after a server restart; values that violate Herdr's plain-command or character constraints are omitted so state reporting is never rejected. A newer pending report replaces stale pending reports while a send is in flight. Socket errors and timeouts do not interrupt the TUI. Normal plugin cleanup awaits `pane.release_agent`, including any in-flight send ahead of it. Each send is bounded to 500 ms, so cleanup waits at most two send intervals (one second); abrupt process termination cannot guarantee delivery.

## Verification

Use a temporary profile and a new pane. Check the pane state at the home screen, while a session is running, while a permission request or form is open, after responding, and after quitting normally. Capture pane state or socket traffic from the real TUI; helper tests alone do not prove plugin activation or shutdown.

Do not publish real prompt content, credentials, user identifiers, or unrelated pane state in PR evidence.

## Placement

Behavior lives in `packages/tui/src/kilocode/herdr-agent-state.ts` on the public TUI plugin API. Registration in `packages/tui/src/plugin/builtins.ts` is a marked rung-4 call-out: the Kilo server host cannot register plugins in the separate TUI process. The shared-patch registry records this exception.
