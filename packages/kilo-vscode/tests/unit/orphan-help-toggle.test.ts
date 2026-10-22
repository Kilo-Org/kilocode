import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it("collapses the leftover-worktree explanation behind a Show more / Show less toggle", () =>
  fixture("orphan-help-toggle"))
