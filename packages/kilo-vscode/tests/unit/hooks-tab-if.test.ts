import { test } from "bun:test"
import { fixture } from "../fixtures/run"

test(
  "hook rows warn that the CLI skips a hook whose if is on an event that does not evaluate it",
  () => fixture("hooks-tab-if"),
  30_000,
)
