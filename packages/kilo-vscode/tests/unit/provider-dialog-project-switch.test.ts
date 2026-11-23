import { describe, it } from "bun:test"
import { fixture } from "../fixtures/run"

describe("provider dialogs after a project switch", () => {
  it("closes a provider dialog on providersReset, keeps a plain dialog, and keeps everything on providersLoading", async () => {
    await fixture("provider-dialog-project-switch")
  })
})
