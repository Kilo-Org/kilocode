import { describe, test, expect, beforeEach } from "bun:test"
import { Identity } from "../identity.js"
import { TelemetryEvent } from "../events.js"
import { Telemetry } from "../telemetry.js"

describe("Identity", () => {
  beforeEach(() => {
    Identity.reset()
  })

  test("getDistinctId returns 'unknown' when no machineId or userId set", () => {
    expect(Identity.getDistinctId()).toBe("unknown")
  })

  test("reset clears userId and organizationId", () => {
    Identity.setOrganizationId("org-123")
    expect(Identity.getOrganizationId()).toBe("org-123")

    Identity.reset()
    expect(Identity.getOrganizationId()).toBeNull()
    expect(Identity.getUserId()).toBeNull()
  })

  test("setOrganizationId sets and gets organization ID", () => {
    Identity.setOrganizationId("org-456")
    expect(Identity.getOrganizationId()).toBe("org-456")

    Identity.setOrganizationId(null)
    expect(Identity.getOrganizationId()).toBeNull()
  })
})

describe("TelemetryEvent", () => {
  test("CLI lifecycle events are defined", () => {
    expect(TelemetryEvent.CLI_START).toBeDefined()
    expect(TelemetryEvent.CLI_EXIT).toBeDefined()
  })

  test("session events are defined", () => {
    expect(TelemetryEvent.SESSION_START).toBeDefined()
    expect(TelemetryEvent.SESSION_END).toBeDefined()
    expect(TelemetryEvent.SESSION_MESSAGE).toBeDefined()
  })

  test("LLM events are defined", () => {
    expect(TelemetryEvent.LLM_COMPLETION).toBeDefined()
  })

  test("feature events are defined", () => {
    expect(TelemetryEvent.COMMAND_USED).toBeDefined()
    expect(TelemetryEvent.TOOL_USED).toBeDefined()
    expect(TelemetryEvent.AGENT_USED).toBeDefined()
  })

  test("indexing events are defined", () => {
    expect(TelemetryEvent.INDEXING_STARTED).toBeDefined()
    expect(TelemetryEvent.INDEXING_COMPLETED).toBeDefined()
    expect(TelemetryEvent.INDEXING_FILE_COUNT).toBeDefined()
    expect(TelemetryEvent.INDEXING_BATCH_RETRY).toBeDefined()
    expect(TelemetryEvent.INDEXING_ERROR).toBeDefined()
  })

  test("auth events are defined", () => {
    expect(TelemetryEvent.AUTH_SUCCESS).toBeDefined()
    expect(TelemetryEvent.AUTH_LOGOUT).toBeDefined()
  })

  test("MCP events are defined", () => {
    expect(TelemetryEvent.MCP_SERVER_CONNECTED).toBeDefined()
    expect(TelemetryEvent.MCP_SERVER_ERROR).toBeDefined()
  })

  test("share events are defined", () => {
    expect(TelemetryEvent.SHARE_CREATED).toBeDefined()
    expect(TelemetryEvent.SHARE_DELETED).toBeDefined()
  })

  test("error event is defined", () => {
    expect(TelemetryEvent.ERROR).toBeDefined()
  })
})

describe("Telemetry", () => {
  test("indexing helpers are exposed", () => {
    expect(typeof Telemetry.trackIndexingStarted).toBe("function")
    expect(typeof Telemetry.trackIndexingCompleted).toBe("function")
    expect(typeof Telemetry.trackIndexingFileCount).toBe("function")
    expect(typeof Telemetry.trackIndexingBatchRetry).toBe("function")
    expect(typeof Telemetry.trackIndexingError).toBe("function")
  })
})
