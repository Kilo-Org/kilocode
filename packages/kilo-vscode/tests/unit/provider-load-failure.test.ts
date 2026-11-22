import { describe, it } from "bun:test"
import { fixture } from "../fixtures/run"

describe("provider view after a failed provider read", () => {
  it("shows the failure copy and no provider from the earlier payload", async () => {
    await fixture("provider-load-failure")
  })
})
