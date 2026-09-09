import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "binds reviews to snapshots and previews published suggestions before token-only apply",
  () => fixture("pr-review-render"),
  30_000,
)
