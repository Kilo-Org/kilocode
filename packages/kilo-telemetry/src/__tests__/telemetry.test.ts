import { arch, platform, release, tmpdir } from "node:os"
import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { describe, test, expect, beforeEach, spyOn } from "bun:test"
import { Client } from "../client.js"
import { Conda } from "../conda.js"
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
    expect(TelemetryEvent.SUGGESTION_SHOWN).toBeDefined()
    expect(TelemetryEvent.SUGGESTION_ACCEPTED).toBeDefined()
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
  test("skips identity updates when disabled", async () => {
    const enabled = spyOn(Client, "isEnabled").mockReturnValue(false)
    const update = spyOn(Identity, "updateFromKiloAuth").mockResolvedValue()

    try {
      await Telemetry.updateIdentity("token")
      expect(update).not.toHaveBeenCalled()
    } finally {
      enabled.mockRestore()
      update.mockRestore()
    }
  })

  test("includes host OS properties", () => {
    const capture = spyOn(Client, "capture").mockImplementation(() => {})

    Telemetry.track(TelemetryEvent.CLI_START)

    expect(capture).toHaveBeenCalledWith(
      TelemetryEvent.CLI_START,
      expect.objectContaining({
        os_name: platform(),
        os_version: release(),
        os_arch: arch(),
      }),
    )
    capture.mockRestore()
  })

  test("ignores a forwarded conda client ID", () => {
    const capture = spyOn(Client, "capture").mockImplementation(() => {})
    try {
      Telemetry.track(TelemetryEvent.CLI_START, { aauClientToken: "supplied" })
      expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("aauClientToken")
    } finally {
      capture.mockRestore()
    }
  })

  test("indexing helpers are exposed", () => {
    expect(typeof Telemetry.trackIndexingStarted).toBe("function")
    expect(typeof Telemetry.trackIndexingCompleted).toBe("function")
    expect(typeof Telemetry.trackIndexingFileCount).toBe("function")
    expect(typeof Telemetry.trackIndexingBatchRetry).toBe("function")
    expect(typeof Telemetry.trackIndexingError).toBe("function")
  })

  test("suggestion helper is exposed", () => {
    expect(typeof Telemetry.trackSuggestionShown).toBe("function")
    expect(typeof Telemetry.trackSuggestionAccepted).toBe("function")
  })

  test("trackToolUsed sends Tool Used event with tool name and sessionId", () => {
    const capture = spyOn(Client, "capture").mockImplementation(() => {})

    try {
      Telemetry.trackToolUsed("chart", "session-123")
      expect(capture).toHaveBeenCalledWith(
        TelemetryEvent.TOOL_USED,
        expect.objectContaining({ tool: "chart", sessionId: "session-123" }),
      )
    } finally {
      capture.mockRestore()
    }
  })
})

const shell = process.platform === "win32" ? test.skip : test

shell("uses conda's effective client ID in events", async () => {
  const root = await mkdtemp(join(tmpdir(), "kilo-aau-"))
  const home = process.env.HOME
  const exe = process.env.CONDA_EXE
  const token = "abcdefghijklmnopqrstuv"
  const conda = join(root, "conda")
  const capture = spyOn(Client, "capture").mockImplementation(() => {})
  const machine = spyOn(Identity, "getMachineId").mockResolvedValue(undefined)

  try {
    await mkdir(join(root, ".conda"))
    await Bun.write(join(root, ".conda", "aau_token"), token)
    await Bun.write(conda, `#!/bin/sh\nprintf '%s\\n' '{"user_agent":"conda/26.1 c/${token}"}'\n`)
    await chmod(conda, 0o755)
    process.env.HOME = root
    process.env.CONDA_EXE = conda

    expect(await Conda.clientToken()).toBe(token)
    await Telemetry.init({ dataPath: root, version: "test", enabled: true })
    Telemetry.trackCliStart()
    expect(capture).toHaveBeenCalledWith(TelemetryEvent.CLI_START, expect.objectContaining({ aauClientToken: token }))

    await Bun.write(conda, "#!/bin/sh\nprintf '%s\\n' '{\"user_agent\":\"conda/26.1\"}'\n")
    expect(await Conda.clientToken()).toBeUndefined()

    Telemetry.setEnabled(false)
    capture.mockClear()
    Telemetry.trackCliStart()
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls.at(0)?.at(1)).not.toHaveProperty("aauClientToken")
  } finally {
    // Clear conda properties while the client is still active; shutdown alone
    // leaves them behind for tests that run later in randomized order.
    Telemetry.setEnabled(false)
    capture.mockRestore()
    machine.mockRestore()
    await Client.shutdown()
    if (home === undefined) delete process.env.HOME
    else process.env.HOME = home
    if (exe === undefined) delete process.env.CONDA_EXE
    else process.env.CONDA_EXE = exe
    await rm(root, { recursive: true, force: true })
  }
})
