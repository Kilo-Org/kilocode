import { arch, platform, release, tmpdir } from "node:os"
import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
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
    // Reporting models select these names; renaming them breaks dashboards.
    const names: string[] = Object.values(TelemetryEvent)
    expect(names).toContain("MCP Auth Started")
    expect(names).toContain("MCP Auth Completed")
    // The editors sent these names before the CLI owned them; existing reports select them.
    expect(names).toContain("Marketplace Item Installed")
    expect(names).toContain("Marketplace Item Removed")
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

const onUnix = process.platform === "win32" ? describe.skip : describe

onUnix("conda client id", () => {
  const token = "abcdefghijklmnopqrstuv"
  const envKeys = [
    "HOME",
    "USERPROFILE",
    "CONDA_EXE",
    "CONDA_ANACONDA_ANON_USAGE",
    "CONDARC",
    "CONDA_ROOT",
    "CONDA_PREFIX",
    "XDG_CONFIG_HOME",
  ] as const
  let root = ""
  const saved: Partial<Record<(typeof envKeys)[number], string | undefined>> = {}

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kilo-aau-"))
    await mkdir(join(root, ".conda"))
    for (const key of envKeys) saved[key] = process.env[key]
    process.env.HOME = root
    process.env.USERPROFILE = root
    for (const key of envKeys) {
      if (key !== "HOME" && key !== "USERPROFILE") delete process.env[key]
    }
  })

  afterEach(async () => {
    for (const key of envKeys) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  })

  async function writeToken(value = `${token}\n`) {
    await Bun.write(join(root, ".conda", "aau_token"), value)
  }

  // A stub that records it was executed. Opt-out must not need this process.
  async function stubConda() {
    const conda = join(root, "conda")
    const stamp = join(root, "conda-ran")
    const quoted = `'${stamp.replaceAll("'", "'\\''")}'`
    await Bun.write(
      conda,
      `#!/bin/sh\nprintf x > ${quoted}\nprintf '%s\\n' '{"user_agent":"conda/26.1 c/${token}"}'\n`,
    )
    await chmod(conda, 0o755)
    process.env.CONDA_EXE = conda
    return stamp
  }

  test("reads the saved client id and does not run conda", async () => {
    await writeToken()
    const stamp = await stubConda()

    expect(await Conda.clientToken()).toBe(token)
    expect(await Bun.file(stamp).exists()).toBe(false)
  })

  test("returns nothing when the token file is missing and does not run conda", async () => {
    const stamp = await stubConda()

    expect(await Conda.clientToken()).toBeUndefined()
    expect(await Bun.file(stamp).exists()).toBe(false)
  })

  test("returns nothing when the saved token is not 22 characters", async () => {
    await writeToken("short\n")
    await stubConda()

    expect(await Conda.clientToken()).toBeUndefined()
  })

  test("returns nothing when CONDA_ANACONDA_ANON_USAGE is no", async () => {
    await writeToken()
    await stubConda()
    process.env.CONDA_ANACONDA_ANON_USAGE = "no"

    expect(await Conda.clientToken()).toBeUndefined()
  })

  test("returns nothing when CONDA_ANACONDA_ANON_USAGE is unrecognized", async () => {
    await writeToken()
    await stubConda()
    process.env.CONDA_ANACONDA_ANON_USAGE = "maybe"

    expect(await Conda.clientToken()).toBeUndefined()
  })

  test("returns nothing when the CONDA_ROOT condarc opts out", async () => {
    await writeToken()
    await stubConda()
    const prefix = join(root, "conda-root")
    await mkdir(prefix)
    await Bun.write(join(prefix, "condarc"), "anaconda_anon_usage: false\n")
    process.env.CONDA_ROOT = prefix

    expect(await Conda.clientToken()).toBeUndefined()
  })

  test("returns nothing when ~/.condarc opts out", async () => {
    await writeToken()
    await stubConda()
    await Bun.write(join(root, ".condarc"), "anaconda_anon_usage: false\n")

    expect(await Conda.clientToken()).toBeUndefined()
  })

  test("returns nothing when ~/.config/conda opts out", async () => {
    await writeToken()
    await stubConda()
    await mkdir(join(root, ".config", "conda"), { recursive: true })
    await Bun.write(join(root, ".config", "conda", ".condarc"), "anaconda_anon_usage: off\n")

    expect(await Conda.clientToken()).toBeUndefined()
  })

  test("lets the environment override a non-final condarc value", async () => {
    await writeToken()
    await stubConda()
    await Bun.write(join(root, ".condarc"), "anaconda_anon_usage: true\n")
    process.env.CONDA_ANACONDA_ANON_USAGE = "off"

    expect(await Conda.clientToken()).toBeUndefined()
  })

  test("lets a later condarc.d file turn telemetry back on", async () => {
    await writeToken()
    const stamp = await stubConda()
    const dir = join(root, ".conda", "condarc.d")
    await mkdir(dir)
    await Bun.write(join(dir, "a.yaml"), "anaconda_anon_usage: false\n")
    await Bun.write(join(dir, "b.yaml"), "anaconda_anon_usage: true\n")

    expect(await Conda.clientToken()).toBe(token)
    expect(await Bun.file(stamp).exists()).toBe(false)
  })

  test("keeps a #!final opt-out ahead of later files and the environment", async () => {
    await writeToken()
    await stubConda()
    const dir = join(root, ".conda", "condarc.d")
    await mkdir(dir)
    await Bun.write(join(dir, "a.yaml"), "anaconda_anon_usage: false #!final\n")
    await Bun.write(join(dir, "b.yaml"), "anaconda_anon_usage: true\n")
    await Bun.write(join(root, ".condarc"), "anaconda_anon_usage: true\n")
    process.env.CONDA_ANACONDA_ANON_USAGE = "yes"

    expect(await Conda.clientToken()).toBeUndefined()
  })

  test("keeps the client id when a final condarc forces telemetry on", async () => {
    await writeToken()
    const stamp = await stubConda()
    await Bun.write(join(root, ".condarc"), "anaconda_anon_usage: true #!final\n")
    process.env.CONDA_ANACONDA_ANON_USAGE = "no"

    expect(await Conda.clientToken()).toBe(token)
    expect(await Bun.file(stamp).exists()).toBe(false)
  })

  test("ignores a commented or indented key and reads the top-level value", async () => {
    await writeToken()
    const stamp = await stubConda()
    await Bun.write(
      join(root, ".condarc"),
      [
        "# anaconda_anon_usage: false",
        "channels:",
        "  - defaults",
        "  anaconda_anon_usage: false",
        'anaconda_anon_usage: "yes"',
        "",
      ].join("\n"),
    )

    expect(await Conda.clientToken()).toBe(token)
    expect(await Bun.file(stamp).exists()).toBe(false)
  })

  test("honors a CONDARC yaml file and ignores a non-condarc path", async () => {
    await writeToken()
    const stamp = await stubConda()
    const notes = join(root, "notes.txt")
    await Bun.write(notes, "anaconda_anon_usage: false\n")
    process.env.CONDARC = notes
    expect(await Conda.clientToken()).toBe(token)

    const custom = join(root, "custom.yml")
    await Bun.write(custom, "anaconda_anon_usage: false\n")
    process.env.CONDARC = custom
    expect(await Conda.clientToken()).toBeUndefined()
    expect(await Bun.file(stamp).exists()).toBe(false)
  })

  test("attaches the client id on CLI start and drops it when telemetry is disabled", async () => {
    await writeToken()
    const stamp = await stubConda()
    const capture = spyOn(Client, "capture").mockImplementation(() => {})
    const machine = spyOn(Identity, "getMachineId").mockResolvedValue(undefined)

    try {
      expect(await Conda.clientToken()).toBe(token)
      await Telemetry.init({ dataPath: root, version: "test", enabled: true })
      Telemetry.trackCliStart()
      expect(capture).toHaveBeenCalledWith(
        TelemetryEvent.CLI_START,
        expect.objectContaining({ aauClientToken: token }),
      )
      expect(await Bun.file(stamp).exists()).toBe(false)

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
    }
  })
})
