# Rules & Workflows Sub-Tabs Parity

**Priority:** P2 (Rules), P3 (Workflows)

The legacy extension had feature-complete Rules and Workflows sub-tabs with toggle lists, file creation, and global/workspace separation. The new extension has a simpler Rules sub-tab and a stub Workflows sub-tab.

## Rules Sub-Tab Comparison

| Feature                        | Legacy                                                                                                                | New                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Description text + docs link   | Yes                                                                                                                   | No                                                              |
| Global rules section           | Toggle list of global rule files                                                                                      | Not separated — single flat list of instruction file paths      |
| Workspace rules section        | Toggle list of workspace rule files                                                                                   | Same flat list                                                  |
| Per-rule enable/disable toggle | `ToggleSwitch` per rule file                                                                                          | Not available — paths are either in the list or removed         |
| Create new rule file           | Input field with validation (.md, .txt, or no extension) per section                                                  | Not available                                                   |
| Add instruction file path      | Not available (auto-discovered from filesystem)                                                                       | `TextField` + "Add" button                                      |
| Rule source discovery          | Auto-discovers from `.kilocode/rules/`, `.kilocoderules`, `.roorules`, `.clinerules`, mode-specific dirs, `AGENTS.md` | Only shows explicitly configured paths in `config.instructions` |

### Key Architectural Difference

The legacy extension auto-discovered rule files from well-known filesystem locations and displayed them with on/off toggles. The new extension treats instruction files as explicit config entries — you add paths to `config.instructions` and they're always active. There's no discovery or toggling.

## Workflows Sub-Tab Comparison

| Feature                            | Legacy                                  | New                                       |
| ---------------------------------- | --------------------------------------- | ----------------------------------------- |
| Description text + docs link       | Yes                                     | Placeholder: "Not yet implemented."       |
| Global workflows section           | Toggle list of global workflow files    | Not available                             |
| Workspace workflows section        | Toggle list of workspace workflow files | Not available                             |
| Per-workflow enable/disable toggle | `ToggleSwitch` per workflow file        | Not available                             |
| Create new workflow file           | Input field per section                 | Not available                             |
| Invoke workflow                    | Type `/workflow-name` in chat           | CLI has custom commands (similar concept) |

## Remaining Work

### Rules (P2)

- **Description text**: Add explanatory description with link to docs, matching the legacy pattern
- **Global vs workspace separation**: If the CLI distinguishes between global and workspace instruction files, separate them into two sections
- **Enable/disable toggles**: If rules can be toggled without removing them from config, add toggle switches per rule
- **New rule file creation**: Add a button/input to create a new rule file (not just add an existing path)
- **Auto-discovery**: Consider adding a section showing auto-discovered rule sources (`.kilocode/rules/`, `AGENTS.md`) that the CLI loads regardless of explicit `config.instructions` entries

### Workflows (P3)

- **Implement the sub-tab**: Replace the placeholder with actual workflow management
- **Determine CLI mapping**: The CLI has custom commands — determine whether "workflows" maps to CLI custom commands or is a distinct concept
- **Workflow file management**: Add toggle list for global/workspace workflow files with create/enable/disable
- **Description text**: Add explanatory description matching the legacy pattern

## Notes

The existing `non-agent-features/rules-and-workflows.md` doc covers workflows broadly. This doc adds the specific UI comparison for what the sub-tabs look like in the Agent Behaviour tab. The CLI's `config.instructions` array is a simpler model than the legacy's auto-discovered toggle list — the extension may need to augment it with discovery logic to match parity.
