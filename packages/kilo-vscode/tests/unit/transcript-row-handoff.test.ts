import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "preserves mounted rows across virtualizer handoff and disposes unused roots",
  () => fixture("transcript-row-handoff"),
  30_000,
)
