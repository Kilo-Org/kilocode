import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "reopens through the real effect trigger once the project list arrives",
  () => fixture("new-worktree-reopen"),
  60_000,
)
