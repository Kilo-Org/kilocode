import { describe, expect, it } from "bun:test"
import { fixture } from "../fixtures/run"

describe("settings write reconciliation", () => {
  it("adopts stored values, restores rejected ones, and keeps the newest intent", () =>
    fixture("config-setting-outcome"))
})
