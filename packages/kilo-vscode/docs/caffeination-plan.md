# Caffeination Plan

1. Add a dependency-free extension-host wake-lock service using `caffeinate` on macOS, `systemd-inhibit` on Linux, and hidden PowerShell `SetThreadExecutionState` on Windows.
2. Start one lock immediately when the user toggle is enabled, so the control has an observable effect even before an agent begins. Keep it until the user disables it or the extension shuts down.
3. Add typed Agent Manager messages and a toolbar coffee button with enabled, active, and unavailable states.
4. Release the lock on disable, unexpected inhibitor exit, and extension shutdown. Never block agent execution when the OS mechanism is unavailable.
5. Add focused service tests, build/type/lint checks, and manual assertion checks on each supported desktop platform.

Scope: prevent system idle sleep while allowing the display to sleep. The toggle is off by default and lasts for the current extension-host lifetime. Remote extension hosts inhibit the machine where the extension runs.

Placement: keep the service at extension activation so sidebar, editor-tab, and Agent Manager sessions share one lock. Put the button in the normal Agent Manager Worktrees header before Settings, and in multi-project mode between Search and Keyboard. `Kilo Code: Toggle Keep Awake` provides access from every extension surface without adding a permanent status-bar item. A `/caffeinate` slash command would require a separate CLI/TUI implementation because slash commands are otherwise sent through the agent workflow.
