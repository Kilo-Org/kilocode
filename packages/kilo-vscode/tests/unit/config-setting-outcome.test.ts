import { describe, expect, it } from "bun:test"
import { fixture } from "../fixtures/run"

describe("settings write reconciliation", () => {
  // The fixture drives real timers (the settle bound and the write after it), so give it
  // room past Bun's default rather than let a slow runner flake the job.
  it(
    "adopts stored values, restores rejected ones, and keeps the newest intent",
    () => fixture("config-setting-outcome"),
    30_000,
  )
})
