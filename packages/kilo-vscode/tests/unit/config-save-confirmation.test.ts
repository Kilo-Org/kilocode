import { describe, expect, it } from "bun:test"
import { fixture } from "../fixtures/run"

describe("settings save confirmation", () => {
  // The fixture drives real timers (the shortened save bound), so give it room past Bun's
  // default rather than let a slow runner flake the job.
  it("settles a save only on the message that echoes its request id", () => fixture("config-save-confirmation"), 30_000)
})
