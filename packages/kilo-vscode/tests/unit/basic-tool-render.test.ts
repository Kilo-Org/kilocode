import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "keeps tool bodies lazy and reserves restored open heights until deferred mount",
  () => fixture("basic-tool-render"),
  30_000,
)
