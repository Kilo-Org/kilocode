import { it } from "bun:test"
import { fixture } from "../fixtures/run"

it(
  "hides the warning trigger with no issues and shows it once an MCP server needs sign-in",
  () => fixture("session-issues"),
  30_000,
)
