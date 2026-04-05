# Re-add Architect Mode / Enhance Plan Mode to Write Plan Files

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6230](https://github.com/Kilo-Org/kilocode/issues/6230)

## Problem

The old Kilo Code extension had an "Architect mode" that would write the resulting plan as a `.md` file into a `/plans` directory in the project root. Users adopted this workflow and now miss it.

The new extension has Plan mode, but plans are stored only inside `.opencode/` — not as human-readable `.md` files in the project. Users can't see or reference their plans easily.

## Remaining Work

Options (pick one or combine):

1. **Enhance Plan mode** — After a plan is finalized, automatically write it as a `.md` file to a `/plans` directory in the project root. The filename could be based on the plan title or a timestamp. This happens in addition to the internal `.opencode/` storage.

2. **Re-add Architect mode** — Add a distinct "Architect" mode that is specifically focused on writing plans as `.md` files to `/plans`.

3. **Prompt Plan mode** — When finishing a plan, offer the user a choice: "Save plan to `/plans/plan-name.md`?" with accept/dismiss.

Option 3 is the least disruptive. The recommended approach is to add an "Export plan" action button in the Plan mode UI that saves the current plan to `/plans/`.

## Implementation Notes

- This requires CLI-side changes to the Plan mode behavior and/or an extension-side "export plan" button
- The plan content is available in the session; extracting it requires identifying what parts constitute the plan output
- `/plans/` directory creation should be done safely (don't overwrite existing files without confirmation)
