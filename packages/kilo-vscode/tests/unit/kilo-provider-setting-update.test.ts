import { afterEach, describe, expect, it } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const vscode = await import("vscode")
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  postMessage: (message: unknown) => void
  handleUpdateSetting: (key: string, value: unknown, writeId?: string) => Promise<void>
  costLimit: () => number | undefined
  trackedSessionIds: Set<string>
  activeAlerts: Map<string, number>
}

type Write = { section: string | undefined; key: string; value: unknown; target: unknown }

const original = vscode.workspace.getConfiguration

function install(writes: Write[], reject?: unknown, stored?: Record<string, unknown>) {
  vscode.workspace.getConfiguration = ((section?: string) => ({
    get: (key: string, fallback: unknown) => stored?.[key] ?? fallback,
    update: async (key: string, value: unknown, target: unknown) => {
      writes.push({ section, key, value, target })
      if (reject !== undefined) throw reject
    },
  })) as typeof original
}

function create() {
  const sent: Array<Record<string, unknown>> = []
  const internal = new KiloProvider({} as never, {} as never) as unknown as Internals
  internal.postMessage = (message) => void sent.push(message as Record<string, unknown>)
  return { internal, sent }
}

afterEach(() => {
  vscode.workspace.getConfiguration = original
})

describe("handleUpdateSetting outcomes", () => {
  it("posts settingUpdated with the stored value", async () => {
    const writes: Write[] = []
    install(writes)
    const { internal, sent } = create()

    await internal.handleUpdateSetting("agentManager.autoBranchNaming", true)

    expect(writes).toEqual([
      {
        section: "kilo-code.new.agentManager",
        key: "autoBranchNaming",
        value: true,
        target: vscode.ConfigurationTarget.Global,
      },
    ])
    expect(sent).toEqual([{ type: "settingUpdated", key: "agentManager.autoBranchNaming", value: true }])
  })

  it("posts settingUpdated with undefined when the webview clears a setting", async () => {
    const writes: Write[] = []
    install(writes)
    const { internal, sent } = create()

    await internal.handleUpdateSetting("agentManager.branchPrefix", null)

    expect(writes.length).toBe(1)
    expect(writes[0]!.value).toBeUndefined()
    expect(sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ type: "settingUpdated", key: "agentManager.branchPrefix" })
    expect(sent[0]!.value).toBeUndefined()
    expect("value" in sent[0]!).toBe(true)
  })

  it("posts settingUpdateFailed and does not throw when the write rejects", async () => {
    install([], new Error("settings.json is read-only"))
    const { internal, sent } = create()

    await internal.handleUpdateSetting("agentManager.pushFixes", false)

    expect(sent).toEqual([
      { type: "settingUpdateFailed", key: "agentManager.pushFixes", message: "settings.json is read-only" },
    ])
  })

  it("posts settingUpdateFailed for an invalid value and performs no write", async () => {
    const writes: Write[] = []
    install(writes)
    const { internal, sent } = create()

    await internal.handleUpdateSetting("chat.shiftTabCyclesVariant", "yes")
    await internal.handleUpdateSetting("indexing.showButtonWhenDisabled", 1)

    expect(writes).toEqual([])
    expect(sent).toEqual([
      {
        type: "settingUpdateFailed",
        key: "chat.shiftTabCyclesVariant",
        message: "Invalid value for the chat.shiftTabCyclesVariant setting.",
      },
      {
        type: "settingUpdateFailed",
        key: "indexing.showButtonWhenDisabled",
        message: "Invalid value for the indexing.showButtonWhenDisabled setting.",
      },
    ])
  })

  it("posts settingUpdated with the normalized maxCost", async () => {
    const writes: Write[] = []
    install(writes)
    const { internal, sent } = create()

    await internal.handleUpdateSetting("maxCost", 5.2)

    expect(writes).toEqual([
      { section: "kilo-code.new", key: "maxCost", value: 6, target: vscode.ConfigurationTarget.Global },
    ])
    expect(sent).toEqual([{ type: "settingUpdated", key: "maxCost", value: 6 }])
  })

  it("posts settingUpdateFailed for maxCost and skips the cost-alert rearm when the write rejects", async () => {
    install([], new Error("settings unavailable"))
    const { internal, sent } = create()
    internal.trackedSessionIds = new Set(["ses_cost"])
    internal.activeAlerts.set("ses_cost", 10)

    await internal.handleUpdateSetting("maxCost", 5)

    expect(sent).toEqual([{ type: "settingUpdateFailed", key: "maxCost", message: "settings unavailable" }])
    expect(internal.activeAlerts.get("ses_cost")).toBe(10)
  })

  it("restores the stored maxCost limit when the write rejects", async () => {
    install([], new Error("settings.json is read-only"), { maxCost: 2 })
    const { internal } = create()

    await internal.handleUpdateSetting("maxCost", 9)

    expect(internal.costLimit()).toBe(2)
  })

  it("keeps the newest committed maxCost when an older overlapping write rejects", async () => {
    const stored: Record<string, unknown> = { maxCost: 2 }
    const pending = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>()
    vscode.workspace.getConfiguration = (() => {
      // Each call captures the stored record as it is now, so a write that
      // restores from this object reads the values visible at its own start.
      const snapshot = { ...stored }
      return {
        get: (key: string, fallback: unknown) => snapshot[key] ?? fallback,
        update: (key: string, value: number) => {
          const deferred = Promise.withResolvers<void>()
          pending.set(value, deferred)
          return deferred.promise
        },
      }
    }) as typeof original
    const { internal, sent } = create()

    const older = internal.handleUpdateSetting("maxCost", 9)
    const newer = internal.handleUpdateSetting("maxCost", 3)

    pending.get(9)!.reject(new Error("settings.json is read-only"))
    await older
    stored.maxCost = 3
    pending.get(3)!.resolve()
    await newer

    expect(internal.costLimit()).toBe(3)
    expect(sent).toEqual([
      { type: "settingUpdateFailed", key: "maxCost", message: "settings.json is read-only" },
      { type: "settingUpdated", key: "maxCost", value: 3 },
    ])
    expect(internal.costLimit()).toBe(vscode.workspace.getConfiguration("kilo-code.new").get<number>("maxCost", 0))
  })
})

describe("handleUpdateSetting write ids", () => {
  it("echoes the write id on a stored write", async () => {
    const writes: Write[] = []
    install(writes)
    const { internal, sent } = create()

    await internal.handleUpdateSetting("agentManager.autoBranchNaming", true, "w-1")

    expect(sent).toEqual([
      { type: "settingUpdated", key: "agentManager.autoBranchNaming", value: true, writeId: "w-1" },
    ])
  })

  it("echoes the write id on an invalid value", async () => {
    const writes: Write[] = []
    install(writes)
    const { internal, sent } = create()

    await internal.handleUpdateSetting("chat.shiftTabCyclesVariant", "yes", "w-2")

    expect(writes).toEqual([])
    expect(sent).toEqual([
      {
        type: "settingUpdateFailed",
        key: "chat.shiftTabCyclesVariant",
        message: "Invalid value for the chat.shiftTabCyclesVariant setting.",
        writeId: "w-2",
      },
    ])
  })

  it("echoes the write id on a rejected write", async () => {
    install([], new Error("settings.json is read-only"))
    const { internal, sent } = create()

    await internal.handleUpdateSetting("agentManager.pushFixes", false, "w-3")

    expect(sent).toEqual([
      {
        type: "settingUpdateFailed",
        key: "agentManager.pushFixes",
        message: "settings.json is read-only",
        writeId: "w-3",
      },
    ])
  })

  it("echoes the write id on a stored maxCost and on a rejected one", async () => {
    const writes: Write[] = []
    install(writes)
    const { internal, sent } = create()

    await internal.handleUpdateSetting("maxCost", 5.2, "w-4")

    expect(sent).toEqual([{ type: "settingUpdated", key: "maxCost", value: 6, writeId: "w-4" }])

    install([], new Error("settings unavailable"))
    const rejected = create()

    await rejected.internal.handleUpdateSetting("maxCost", 5, "w-5")

    expect(rejected.sent).toEqual([
      { type: "settingUpdateFailed", key: "maxCost", message: "settings unavailable", writeId: "w-5" },
    ])
  })

  it("sends no writeId when the request carried none", async () => {
    const writes: Write[] = []
    install(writes)
    const { internal, sent } = create()

    await internal.handleUpdateSetting("agentManager.autoBranchNaming", true)

    expect(sent).toHaveLength(1)
    expect(sent[0]!).not.toHaveProperty("writeId")
  })
})
