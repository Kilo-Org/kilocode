import { describe, expect, it } from "bun:test"
import { formatIndexingLabel, indexingTone } from "../../webview-ui/src/context/indexing-utils"
import { mapSSEEventToWebviewMessage } from "../../src/kilo-provider-utils"
import { configFeatures } from "../../src/features"
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

  it("maps indexing.status regardless of sessionID (filtering is caller responsibility)", () => {
    const event: EventIndexingStatus = {
      type: "indexing.status",
      properties: {
        status: makeStatus({ state: "Disabled", message: "Indexing is disabled in worktree sessions." }),
      },
    }

    const msg = mapSSEEventToWebviewMessage(event, undefined)
    expect(msg?.type).toBe("indexingStatusLoaded")
    if (msg?.type === "indexingStatusLoaded") {
      expect(msg.status.state).toBe("Disabled")
      expect(msg.status.message).toBe("Indexing is disabled in worktree sessions.")
    }
  })
})

describe("indexing feature detection", () => {
  it("requires experimental.semantic_indexing when indexing plugin is present", () => {
    expect(configFeatures({ plugin: ["kilo-indexing"] }).indexing).toBe(false)
    expect(configFeatures({ plugin: ["kilo-indexing"], experimental: {} }).indexing).toBe(false)
    expect(configFeatures({ plugin: ["kilo-indexing"], experimental: { semantic_indexing: false } }).indexing).toBe(
      false,
    )
  })

  it("detects supported indexing plugin specifiers when experimental.semantic_indexing is true", () => {
    expect(configFeatures({ plugin: ["kilo-indexing"], experimental: { semantic_indexing: true } }).indexing).toBe(true)
    expect(
      configFeatures({ plugin: ["kilo-indexing@1.2.3"], experimental: { semantic_indexing: true } }).indexing,
    ).toBe(true)
    expect(
      configFeatures({ plugin: ["@kilocode/kilo-indexing"], experimental: { semantic_indexing: true } }).indexing,
    ).toBe(true)
    expect(
      configFeatures({ plugin: ["@kilocode/kilo-indexing@1.2.3"], experimental: { semantic_indexing: true } }).indexing,
    ).toBe(true)
    expect(
      configFeatures({
        plugin: ["file:///tmp/.opencode/plugin/kilo-indexing.js"],
        experimental: { semantic_indexing: true },
      }).indexing,
    ).toBe(true)
    expect(
      configFeatures({
        plugin: ["file:///tmp/node_modules/@kilocode/kilo-indexing/index.js"],
        experimental: { semantic_indexing: true },
      }).indexing,
    ).toBe(true)
  })

  it("ignores unrelated plugin lists", () => {
    expect(configFeatures({ plugin: ["@kilocode/kilo-gateway"] }).indexing).toBe(false)
    expect(configFeatures({ plugin: ["file:///tmp/.opencode/plugin/index.js"] }).indexing).toBe(false)
    expect(configFeatures({}).indexing).toBe(false)
  })
})
