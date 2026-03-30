# Settings Migration from Old Extension

**Priority:** P1
**Issue:** [#6089](https://github.com/Kilo-Org/kilocode/issues/6089)

## Remaining Work

- On first activation, detect whether old extension settings exist in `vscode.ExtensionContext.globalState` or `vscode.workspace.getConfiguration('kilo-code')`
- Read relevant settings: API keys, provider configuration, model preferences, auto-approve rules, custom instructions
- Map old settings keys to CLI config equivalents in `opencode.json`
- If CLI config already has settings, show a diff and ask user to confirm before overwriting
- Write approved settings to CLI config via `/global/config` endpoint or directly to `opencode.json`
- Show what was migrated and what was not
- Mark migration as complete in `globalState` so it doesn't run again

## Agent Behaviour Tab Settings to Migrate

Settings from the legacy "Agent Behaviour" tab (Modes, MCP Servers, Rules, Workflows, Skills sub-tabs):

| Legacy Setting                                        | CLI Equivalent                                            | Notes                                                            |
| ----------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `customModes` (custom mode definitions)               | CLI agent config in `opencode.json`                       | Map `roleDefinition` → `prompt`, `groups` → CLI tool permissions |
| `customModePrompts` (per-mode overrides)              | Per-agent `prompt`, `temperature`, etc.                   | Map each mode slug to CLI agent name                             |
| `customInstructions` (global, shown in Modes sub-tab) | Rule files in `.kilocode/rules/` or `config.instructions` | May need a global instructions config key in CLI                 |
| `modeApiConfigs` (per-mode model)                     | Per-agent `model`                                         | Map mode slug → agent name → model ID                            |
| MCP server configs                                    | `config.mcp`                                              | CLI owns MCP config                                              |
| `localRulesToggles` / `globalRulesToggles`            | `config.instructions`                                     | Toggle state doesn't map directly — CLI has path list            |
| `localWorkflowToggles` / `globalWorkflowToggles`      | CLI custom commands (TBD)                                 | Workflow concept mapping needs clarification                     |

See [Agent Behaviour Tab Parity](../agent-behaviour/) docs for detailed sub-tab comparisons.
