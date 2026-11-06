import { expect, it } from "bun:test"
import { readCached } from "../../webview-ui/agent-manager/new-worktree-draft"
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

it("drops an allocation count above the maximum", () => {
  const draft = readCached({
    advancedDialogDraft: {
      allocations: [
        { providerID: "kilo", modelID: "m1", name: "Kept", count: 2 },
        { providerID: "kilo", modelID: "m2", name: "Too Many", count: 5 },
      ],
    },
  })
  expect(draft.allocations?.map((item) => item.name)).toEqual(["Kept"])
})
