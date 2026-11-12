import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("gates New Worktree creation on the selected project's readiness", () => fixture("new-worktree-readiness"), 60_000)

it(
  "installs Git or Git LFS from the card and reopens after Reload",
  () => fixture("new-worktree-readiness", { READINESS_CASE: "install" }),
  60_000,
)
