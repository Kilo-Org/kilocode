import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "requires explicit worktree confirmation and preserves activity and dismissal",
  () => fixture("worktree-finish"),
  30_000,
)
