# Herdr agent-state reporting

The Kilo v2 TUI reports the active session family's state to the Herdr pane that contains it. This integration does not add a server endpoint or change terminals outside Herdr.

## Activation

Launch Kilo inside a Herdr pane. Herdr supplies these variables; do not copy another pane's identity:

| Variable | Requirement |
|---|---|
| `HERDR_ENV` | Exactly `1` |
| `HERDR_PANE_ID` | The containing pane's ID |
| `HERDR_SOCKET_PATH` | The local Herdr socket path |

If any required variable is absent, the plugin does not connect or report. If `HERDR_SOCKET_PATH` does not fit a unix socket address (104 bytes on macOS and the BSDs, 108 on Linux, terminator included), the plugin shows an error toast and stays off for that run, because every connection would fail. To test a checkout without touching an installed Kilo profile, run inside a new Herdr pane:

```sh
KILO_V2_PROFILE=$(mktemp -d) bun dev --standalone
```

## Reported states

The plugin follows the displayed session and its descendants through the reactive TUI data store, so a change is reported when it happens rather than on a poll. It reports the root session ID, not the selected child's ID.

| State | Meaning |
|---|---|
| `blocked` | A permission request or form awaits input anywhere in the session family. Permissions take precedence over forms; the explanatory message is English, like the rest of the TUI. |
| `working` | A family member is running or has non-synthetic pending input. |
| `idle` | Neither condition applies, or the TUI is on its home screen. |

The family scan is `sessionActivity` in `packages/tui/src/kilocode/session-activity.ts`, shared with the terminal activity packets (`terminal-activity.ts`) so the two Kilo reporters cannot drift. Upstream's `packages/tui/src/context/session-tabs.tsx` keeps its own copy of the same rules.

Blocked state takes precedence over working state. Synthetic pending items alone do not indicate work. Identical reports are deduplicated; this is change reporting, not a heartbeat. A report counts as delivered only once Herdr replies on the socket. A connection error, early close or timeout leaves it undelivered, and the reporter retries the same state one second later until Herdr answers or the state changes. A state whose send is still in flight is not sent twice. A reply that rejects the request (for example `pane_not_found` or `invalid_resume_argv`) counts as answered, since the same payload would be rejected again; the first rejection is logged once per run.

## Relation to OSC 7501 program status

Upstream's `packages/tui/src/context/program-status.ts` also reports session state, as OSC 7501 records written to the terminal. The two channels serve different Herdr products and are not expected to be active in the same pane:

| | Herdr socket (this plugin) | OSC 7501 (upstream) |
|---|---|---|
| Consumer | Herdr TUI (`herdrdev/herdr`), Sheprd | Herdr app and `herdr-core`, and any other terminal that implements the protocol |
| Enabled when | The pane sets `HERDR_ENV=1`, `HERDR_PANE_ID` and `HERDR_SOCKET_PATH` | The terminal answers the OSC 7501 query; OpenTUI sends nothing otherwise |
| Scope | The displayed session family | Every open session tab plus the displayed session |
| Carries | State, message, root session ID, `resume_argv`, release on exit | State, permission or question kind, title, message |
| App identity | `kilo` | `OPENCODE_PROGRAM_STATUS_APP`, which the Kilo host sets to `kilo` (`packages/kilo-cli/src/env.ts`); upstream's default is `opencode` |

Herdr TUI needs the socket because that is the only channel that registers the pane as an agent and stores the resume command. Its docs say an agent's own reports decide the state. The Herdr app and `herdr-core` take status from OSC 7501 only and set `HC_TERMINAL_ID` rather than the `HERDR_*` variables, so this plugin stays off there. In a Herdr TUI pane the socket report is therefore authoritative.

If a future Herdr TUI also answers the OSC 7501 query, both channels would be live in one pane. They can then differ without either being wrong: OSC 7501 includes tabs that are not displayed and uses upstream's wording ("Permission needs input"), while the socket reports only the displayed family ("Waiting for permission"). That Herdr TUI does not answer the query today comes from a third-party plugin's README (`musingfox/herdr-osc7501`, Herdr 0.9.5), not from a test here.

## Requests

Requests are newline-delimited JSON using `pane.report_agent`, source and agent `kilo`, and increasing sequence numbers. When a session is active, reports also include `resume_argv` (`[<cli>, "--session", <rootSessionID>]`, using `OPENCODE_CLI_NAME`, which is `kilo2` during v2 development and flips to `kilo` on release) so Herdr 1 (0.9.2+) can restore the session after a server restart; values that violate Herdr's plain-command or character constraints are omitted so state reporting is never rejected. A newer pending report replaces stale pending reports while a send is in flight. Socket errors and timeouts do not interrupt the TUI. Normal plugin cleanup awaits `pane.release_agent`, including any in-flight send ahead of it. `packages/tui/test/kilocode/herdr-agent-state-shutdown.test.ts` proves this against the real TUI: it starts the app with the builtin plugin, shuts it down, and checks that shutdown completes only after a deliberately late answer to the release. Each send is bounded to 500 ms, so cleanup waits at most two send intervals (one second); abrupt process termination cannot guarantee delivery.

## Verification

Use a temporary profile and a new pane. Check the pane state at the home screen, while a session is running, while a permission request or form is open, after responding, and after quitting normally. Capture pane state or socket traffic from the real TUI; helper tests alone do not prove plugin activation or shutdown.

Do not publish real prompt content, credentials, user identifiers, or unrelated pane state in PR evidence.

## Placement

Behavior lives in `packages/tui/src/kilocode/herdr-agent-state.ts` on the public TUI plugin API. Registration in `packages/tui/src/plugin/builtins.ts` is a marked rung-4 call-out: the Kilo server host cannot register plugins in the separate TUI process. The shared-patch registry records this exception.
