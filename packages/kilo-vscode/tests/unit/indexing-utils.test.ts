import { describe, expect, it } from "bun:test"
import { formatIndexingLabel, indexingTone } from "../../webview-ui/src/context/indexing-utils"
import { mapSSEEventToWebviewMessage } from "../../src/kilo-provider-utils"
import type { EventIndexingStatus, IndexingStatus } from "@kilocode/sdk/v2/client"

function makeStatus(overrides: Partial<IndexingStatus> = {}): IndexingStatus {
  return {
    state: "Disabled",
    message: "Indexing disabled.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    ...overrides,
  }
}

describe("indexing formatting", () => {
  it("formats in-progress status like the TUI", () => {
    const status = makeStatus({ state: "In Progress", percent: 42, processedFiles: 21, totalFiles: 50 })
    expect(formatIndexingLabel(status)).toBe("IDX 42% 21/50")
  })

  it("formats error status with the backend message", () => {
    const status = makeStatus({ state: "Error", message: "Indexing failed." })
    expect(formatIndexingLabel(status)).toBe("IDX Indexing failed.")
  })

  it("formats complete and disabled states with the public state label", () => {
    expect(formatIndexingLabel(makeStatus({ state: "Complete" }))).toBe("IDX Complete")
    expect(formatIndexingLabel(makeStatus({ state: "Disabled" }))).toBe("IDX Disabled")
  })

  it("maps tones by status", () => {
    expect(indexingTone(makeStatus({ state: "Disabled" }))).toBe("muted")
    expect(indexingTone(makeStatus({ state: "In Progress" }))).toBe("warning")
    expect(indexingTone(makeStatus({ state: "Complete" }))).toBe("success")
    expect(indexingTone(makeStatus({ state: "Error" }))).toBe("error")
  })
})

describe("indexing SSE mapping", () => {
  it("maps indexing.status to indexingStatusLoaded", () => {
    const event: EventIndexingStatus = {
      type: "indexing.status",
      properties: {
        status: makeStatus({ state: "Complete", percent: 100 }),
      },
    }

    const msg = mapSSEEventToWebviewMessage(event, undefined)
    expect(msg?.type).toBe("indexingStatusLoaded")
    if (msg?.type === "indexingStatusLoaded") {
      expect(msg.status.state).toBe("Complete")
      expect(msg.status.percent).toBe(100)
    }
  })
})
