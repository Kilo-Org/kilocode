import { afterEach, describe, expect, it } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const vscode = await import("vscode")
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  postMessage: (message: unknown) => void
  handleUpdateSetting: (key: string, value: unknown) => Promise<void>
  trackedSessionIds: Set<string>
  activeAlerts: Map<string, number>
}

type Write = { section: string | undefined; key: string; value: unknown; target: unknown }

const original = vscode.workspace.getConfiguration

function install(writes: Write[], reject?: unknown) {
  vscode.workspace.getConfiguration = ((section?: string) => ({
    get: (_key: string, fallback: unknown) => fallback,
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

    expect(sent).toEqual([
      { type: "settingUpdateFailed", key: "maxCost", message: "settings unavailable" },
    ])
    expect(internal.activeAlerts.get("ses_cost")).toBe(10)
  })
})
