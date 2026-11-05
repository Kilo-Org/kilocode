import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("gates New Worktree creation on the selected project's readiness", () => fixture("new-worktree-readiness"), 60_000)
