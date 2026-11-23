# Herdr agent-state reporting

The Kilo v2 TUI can report the active session family's state to the Herdr pane that contains it. This experimental integration does not add a server endpoint or change terminals outside Herdr.

## Enable

Enable `experimental.herdr_agent_state` in `kilo2.json`:

```json
{
  "experimental": {
    "herdr_agent_state": true
  }
}
```

Feature flags default on in local/dev builds and off in release builds. `OPENCODE_FLAGS=herdr_agent_state` enables this flag; `OPENCODE_FLAGS=-herdr_agent_state` disables it, including when all flags are enabled.

Launch Kilo inside a Herdr pane. Herdr supplies these variables; do not copy another pane's identity:

| Variable | Requirement |
|---|---|
| `HERDR_ENV` | Exactly `1` |
| `HERDR_PANE_ID` | The containing pane's ID |
| `HERDR_SOCKET_PATH` | The local Herdr socket path |

If the flag is disabled or any required variable is absent, the plugin does not connect or report. To test a checkout without touching an installed Kilo profile, run inside a new Herdr pane:

```sh
KILO_V2_PROFILE=$(mktemp -d) OPENCODE_FLAGS=herdr_agent_state bun dev --standalone
```

## Reported states

The plugin samples the displayed session and its descendants once per second. It reports the root session ID, not the selected child's ID.

| State | Meaning |
|---|---|
| `blocked` | A permission request or form awaits input anywhere in the session family. Permissions take precedence over forms; the explanatory message is localized. |
| `working` | A family member is running or has non-synthetic pending input. |
| `idle` | Neither condition applies, or the TUI is on its home screen. |

Messages use the runtime locale reported by `Intl.DateTimeFormat`, with English as the fallback for unsupported locales. Non-English dictionaries are loaded only when the integration is active. Restart the TUI after changing the flag or runtime locale.

Blocked state takes precedence over working state. Synthetic pending items alone do not indicate work. Identical reports are deduplicated; this is change reporting, not a heartbeat.

Requests are newline-delimited JSON using `pane.report_agent`, source and agent `kilo2`, and increasing sequence numbers. A newer pending report replaces stale pending reports while a send is in flight. Socket errors and timeouts do not interrupt the TUI. Normal plugin cleanup awaits `pane.release_agent`, including any in-flight send ahead of it. Each send is bounded to 500 ms, so cleanup waits at most two send intervals (one second); abrupt process termination cannot guarantee delivery.

## Verification

Use a temporary profile and a new pane. Check the pane state at the home screen, while a session is running, while a permission request or form is open, after responding, and after quitting normally. Repeat with `OPENCODE_FLAGS=-herdr_agent_state` to confirm the integration remains inactive. Capture pane state or socket traffic from the real TUI; helper tests alone do not prove plugin activation or shutdown.

Do not publish real prompt content, credentials, user identifiers, or unrelated pane state in PR evidence.

## Placement

Behavior lives in `packages/tui/src/kilocode/herdr-agent-state.ts` on the public TUI plugin API. Registration in `packages/tui/src/plugin/builtins.ts` is a marked rung-4 call-out: the Kilo server host cannot register plugins in the separate TUI process. The shared-patch registry records this exception.
