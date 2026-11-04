# Flows plugin prototype

This local TUI plugin adds `/periodic` and lists the managed Kilo flows and unmanaged native schedules reported by the
local server. The page refreshes every 10 seconds while open; press `r` to refresh immediately. Use the arrow keys or
`j`/`k` to select a Flow and Enter to open its latest run Session.

Agents can create scheduled definitions with `flow_create` and start an extra run immediately with `flow_run`. Each
run creates a fresh Session in the saved directory, or in a new worktree when the Flow requests one. Creation asks the
user to approve the Flow's explicit unattended permission allowlist. Runs deny every permission outside that
allowlist instead of waiting for an interactive response. If a scheduled occurrence arrives while the same Flow has a
starting or running execution, the occurrence is recorded as skipped and is not queued.

The scheduler runs inside Kilo's managed background service. It survives closing the TUI, but this prototype does not
install an operating-system startup service: after a reboot, a Kilo client must start or discover the background
service before scheduled Flows can fire. A standalone development process schedules only while that process is open.

Run it from the repository root with an isolated profile:

```bash
KILO_V2_PROFILE=$(mktemp -d) \
OPENCODE_CLI_CONFIG_CONTENT="{\"plugins\":[\"$PWD/packages/kilo-flows-plugin\"]}" \
bun dev . --standalone
```

Type `/periodic` and press Enter. Press Escape to return to the previous page.
