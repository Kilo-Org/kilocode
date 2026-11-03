# Flows plugin prototype

This local TUI plugin adds `/periodic` and lists the managed Kilo flows and unmanaged native schedules reported by the
local server. The page refreshes every 10 seconds while open; press `r` to refresh immediately. Use the arrow keys or
`j`/`k` to select a Flow and Enter to open its latest run Session.

Agents can create managed definitions with `flow_create` and start one immediately with `flow_run`. A manual run
creates a fresh Session in the saved directory, or in a new worktree when the Flow requests one. Definitions remain
paused because this prototype does not connect them to the scheduler yet. Creation asks the user to approve the
Flow's explicit unattended permission allowlist. Runs deny every permission outside that allowlist instead of waiting
for an interactive response.

Run it from the repository root with an isolated profile:

```bash
KILO_V2_PROFILE=$(mktemp -d) \
OPENCODE_CLI_CONFIG_CONTENT="{\"plugins\":[\"$PWD/packages/kilo-flows-plugin\"]}" \
bun dev . --standalone
```

Type `/periodic` and press Enter. Press Escape to return to the previous page.
