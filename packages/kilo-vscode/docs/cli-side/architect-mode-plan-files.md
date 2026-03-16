# Re-add Architect Mode / Enhance Plan Mode to Write Plan Files

**Priority:** P2
**Issue:** [#6230](https://github.com/Kilo-Org/kilocode/issues/6230)

Plans are stored only inside `.opencode/`, not as human-readable `.md` files in the project.

## Remaining Work

- Add an "Export plan" action that saves the current plan to `/plans/plan-name.md`
- Options: enhance Plan mode to auto-save, re-add Architect mode, or add a prompt-based export
- Recommended: "Export plan" button in Plan mode UI
- `/plans/` directory creation should not overwrite existing files without confirmation
