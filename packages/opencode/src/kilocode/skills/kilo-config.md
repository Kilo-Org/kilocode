# Kilo Configuration

Load only the reference needed for the current task using the exact calls below. References are bundled in the CLI, not filesystem paths or separate skills; no Read or network request is needed.

| Topic | Tool call |
|---|---|
| Config paths, precedence, environment overrides, providers, top-level fields | `skill({name:"kilo-config",reference:"configuration"})` |
| Commands, agents, legacy workflows, skills; finding a named command | `skill({name:"kilo-config",reference:"customization"})` |
| Permissions and MCP servers/tool permissions | `skill({name:"kilo-config",reference:"tools"})` |
| Agent Manager setup/run scripts, worktrees, integration/conflicts, state recovery | `skill({name:"kilo-config",reference:"agent-manager"})` |
| TUI settings, themes, keybinds, slash commands | `skill({name:"kilo-config",reference:"tui"})` |
