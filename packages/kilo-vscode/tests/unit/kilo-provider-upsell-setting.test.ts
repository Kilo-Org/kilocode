import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { KiloProvider } from "../../src/KiloProvider"
import { buildChatSettingsMessage } from "../../src/kilo-provider/chat-settings"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"

const original = vscode.workspace.getConfiguration
const resources: { dispose(): void }[] = []
const key = "kilo-code.new.experimental.agentManagerUpsell"

afterEach(() => {
  for (const resource of resources.splice(0).reverse()) resource.dispose()
  vscode.workspace.getConfiguration = original
})

function config() {
  const values = new Map<string, unknown>()
  const writes: { section?: string; key: string; value: unknown; target: unknown }[] = []
  vscode.workspace.getConfiguration = ((section?: string) => ({
    get: (leaf: string, fallback: unknown) =>
      values.has(`${section}.${leaf}`) ? values.get(`${section}.${leaf}`) : fallback,
    update: async (leaf: string, value: unknown, target: unknown) => {
      writes.push({ section, key: leaf, value, target })
      if (value === undefined) {
        values.delete(`${section}.${leaf}`)
        return
      }
      values.set(`${section}.${leaf}`, value)
    },
  })) as typeof original
  return { values, writes }
}

async function attach() {
  const connection = new KiloConnectionService({} as never)
  resources.push(connection)
  const provider = new KiloProvider({} as never, connection)
  resources.push(provider)
  const internal = provider as unknown as {
    initConnectionPromise: Promise<void>
    configSettings(): Record<string, unknown>
  }
  internal.initConnectionPromise = Promise.resolve()
  const pending = Promise.withResolvers<(message: Record<string, unknown>) => Promise<void>>()
  const sent: unknown[] = []
  provider.attachToWebview({
    postMessage: async (message: unknown) => sent.push(message),
    onDidReceiveMessage: (handler: (message: Record<string, unknown>) => Promise<void>) => {
      pending.resolve(handler)
      return { dispose() {} }
    },
  } as never)
  return { internal, sent, receive: await pending.promise }
}

describe("Agent Manager upsell experimental setting", () => {
  it("contributes a disabled-by-default application-wide boolean", async () => {
    const manifest = await Bun.file(new URL("../../package.json", import.meta.url)).json()

    expect(manifest.contributes.configuration.properties[key]).toEqual({
      type: "boolean",
      default: false,
      scope: "application",
      description: expect.any(String),
    })
  })

  it.each([undefined, true, false])("reads the saved preference %s in host snapshots", async (enabled) => {
    const state = config()
    if (enabled !== undefined) state.values.set(key, enabled)
    const host = await attach()

    expect(host.internal.configSettings().agentManagerUpsell).toBe(enabled ?? false)
    expect(buildChatSettingsMessage().settings.agentManagerUpsell).toBe(enabled ?? false)
    expect(state.writes).toEqual([])
  })

  it("routes webview ON/OFF updates to global experimental settings and reloads them", async () => {
    const state = config()
    const host = await attach()
    expect(host.internal.configSettings().agentManagerUpsell).toBe(false)

    for (const enabled of [true, false]) {
      await host.receive({ type: "updateSetting", key: "experimental.agentManagerUpsell", value: enabled })

      expect(state.writes.at(-1)).toEqual({
        section: "kilo-code.new.experimental",
        key: "agentManagerUpsell",
        value: enabled,
        target: vscode.ConfigurationTarget.Global,
      })
      expect(state.values.get(key)).toBe(enabled)
      expect(host.internal.configSettings().agentManagerUpsell).toBe(enabled)
      expect(buildChatSettingsMessage().settings.agentManagerUpsell).toBe(enabled)
      const reloaded = await attach()
      expect(reloaded.internal.configSettings().agentManagerUpsell).toBe(enabled)
      expect(reloaded.sent).toEqual([])
    }
    expect(state.writes).toHaveLength(2)
    expect(host.sent).toEqual([])
  })

  it("clears the global override through the generic null update and restores the default", async () => {
    const state = config()
    state.values.set(key, true)
    const host = await attach()

    await host.receive({ type: "updateSetting", key: "experimental.agentManagerUpsell", value: null })

    expect(state.writes).toEqual([
      {
        section: "kilo-code.new.experimental",
        key: "agentManagerUpsell",
        value: undefined,
        target: vscode.ConfigurationTarget.Global,
      },
    ])
    expect(state.values.has(key)).toBe(false)
    expect(host.internal.configSettings().agentManagerUpsell).toBe(false)
    expect(buildChatSettingsMessage().settings.agentManagerUpsell).toBe(false)
    const reloaded = await attach()
    expect(reloaded.internal.configSettings().agentManagerUpsell).toBe(false)
    expect(host.sent).toEqual([])
  })
})
