import { describe, expect, it } from "bun:test"
import type { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import type { ToWebview } from "../src/protocol"
import {
  applyIndexingStatusMessage,
  formatIndexingLabel,
  indexingButtonVisible,
  indexingEventSelected,
  indexingTone,
} from "../webview-ui/src/context/indexing-utils"

type Status = KiloIndexingRpc.Status

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    state: "Disabled",
    message: "Indexing disabled.",
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
    ...overrides,
  }
}

describe("indexing button visibility", () => {
  it("shows the button while indexing is off by default", () => {
    expect(indexingButtonVisible(true, {}, {})).toBe(true)
  })

  it("hides the button when indexing is off and the preference is disabled", () => {
    expect(indexingButtonVisible(false, {}, {})).toBe(false)
  })

  it("shows the button when project indexing is enabled", () => {
    expect(indexingButtonVisible(false, { enabled: true }, {})).toBe(true)
    expect(indexingButtonVisible(false, { enabled: true }, { enabled: false })).toBe(true)
  })

  it("stays hidden when global and project indexing are off", () => {
    expect(indexingButtonVisible(false, { enabled: false }, { enabled: false })).toBe(false)
  })

  it("shows the button whenever global indexing is enabled", () => {
    expect(indexingButtonVisible(false, { enabled: false }, { enabled: true })).toBe(true)
  })
})

describe("indexing formatting", () => {
  it("formats in-progress status like the TUI", () => {
    const status = makeStatus({ state: "In Progress", percent: 42, processedFiles: 21, totalFiles: 50 })
    expect(formatIndexingLabel(status)).toBe("IDX 42% 21/50")
  })

  it("formats indeterminate in-progress status without 0/0 counts", () => {
    const status = makeStatus({ state: "In Progress", percent: 0, processedFiles: 0, totalFiles: 0 })
    expect(formatIndexingLabel(status)).toBe("IDX In Progress")
  })

  it("formats error status with the backend message", () => {
    const status = makeStatus({ state: "Error", message: "Indexing failed." })
    expect(formatIndexingLabel(status)).toBe("IDX Indexing failed.")
  })

  it("formats complete and disabled states with the public state label", () => {
    expect(formatIndexingLabel(makeStatus({ state: "Complete" }))).toBe("IDX Complete")
    expect(formatIndexingLabel(makeStatus({ state: "Disabled" }))).toBe("IDX Disabled")
    expect(formatIndexingLabel(makeStatus({ state: "Standby" }))).toBe("IDX Standby")
  })

  it("maps tones by status", () => {
    expect(indexingTone(makeStatus({ state: "Disabled" }))).toBe("muted")
    expect(indexingTone(makeStatus({ state: "Standby" }))).toBe("muted")
    expect(indexingTone(makeStatus({ state: "In Progress" }))).toBe("warning")
    expect(indexingTone(makeStatus({ state: "Complete" }))).toBe("success")
    expect(indexingTone(makeStatus({ state: "Error" }))).toBe("error")
  })
})

describe("indexing status event selection", () => {
  const projects = [
    { id: "a", root: "/main", label: "main" },
    { id: "b", root: "/other", directory: "/other", label: "other" },
  ]

  it("keeps the events of a selected project with a directory only", () => {
    expect(indexingEventSelected("/other/", "/other", projects)).toBe(true)
    expect(indexingEventSelected("/workspace", "/other", projects)).toBe(false)
  })

  it("keeps the primary events and drops the ones of other listed projects", () => {
    expect(indexingEventSelected("/workspace/sub", undefined, projects)).toBe(true)
    expect(indexingEventSelected("/other", undefined, projects)).toBe(false)
  })
})

describe("indexing status message handling", () => {
  it("applies indexing status regardless of feature-toggle race", () => {
    let status = makeStatus()
    let loading = true
    const applied = applyIndexingStatusMessage(
      {
        type: "indexingStatusLoaded",
        status: makeStatus({
          state: "In Progress",
          message: "Indexing",
          processedFiles: 5,
          totalFiles: 20,
          percent: 25,
        }),
      },
      (next) => {
        status = next
      },
      (next) => {
        loading = next
      },
    )

    expect(applied).toBe(true)
    expect(status.state).toBe("In Progress")
    expect(status.percent).toBe(25)
    expect(loading).toBe(false)
  })

  it("ignores unrelated extension messages", () => {
    let status = makeStatus()
    let loading = true
    const applied = applyIndexingStatusMessage(
      { type: "response", id: 1, status: 200, statusText: "OK", headers: [] } satisfies ToWebview,
      (next) => {
        status = next
      },
      (next) => {
        loading = next
      },
    )

    expect(applied).toBe(false)
    expect(status.state).toBe("Disabled")
    expect(loading).toBe(true)
  })
})
