import { describe, it } from "bun:test"
import { fixture } from "../fixtures/run"

describe("provider dialog after a project switch", () => {
  it("closes the open dialog on providersReset and keeps it on providersLoading", async () => {
    await fixture("provider-dialog-project-switch")
  })
})
