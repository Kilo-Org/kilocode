import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "renders the PR conversation timeline with commits and lifecycle events",
  () => fixture("pr-conversation-render"),
  30_000,
)
