import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "renders PR threads and preserves editor actions, suggestions, drafts, and focus",
  () => fixture("pr-comments-render"),
  30_000,
)
