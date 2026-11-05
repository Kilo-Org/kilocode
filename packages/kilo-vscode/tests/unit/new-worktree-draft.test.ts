import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "restores the full New Worktree draft after a remount",
  () => fixture("new-worktree-draft", { DRAFT_CASE: "roundtrip" }),
  60_000,
)

it(
  "does not pin an untouched draft to the old project or substitute a missing one",
  () => fixture("new-worktree-draft", { DRAFT_CASE: "missing" }),
  60_000,
)

it(
  "keeps an explicit project-row click over a saved draft project",
  () => fixture("new-worktree-draft", { DRAFT_CASE: "explicit" }),
  60_000,
)

it(
  "keeps restored draft choices while the model catalog arrives",
  () => fixture("new-worktree-draft", { DRAFT_CASE: "catalog" }),
  60_000,
)
