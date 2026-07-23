import { describe, expect, it, spyOn } from "bun:test"
import * as vscode from "vscode"
import type { Config } from "@kilocode/sdk/v2/client"

const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  webview: { postMessage: () => Promise<boolean> } | null
  initializeConnection: () => Promise<void>
  handleResetAllSettings: () => Promise<void>
  syncWebviewState: () => Promise<void>
  flushPendingSessionRefresh: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendIndexingStatus: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
  seedSessionStatusMap: () => Promise<void>
  checkConfigWarnings: () => Promise<void>
  recoverPendingPrompts: () => void
  memory: { fetch: () => Promise<void> }
}

function setup(opts: { config?: Config; fail?: Error } = {}) {
  const events: string[] = []
  const updates: Array<[string, unknown]> = []
  const agentCalls: unknown[] = []
  const connections: string[] = []
  let state: unknown = { "agent/code/anthropic/claude-sonnet-4": "high" }
  const make = () => ({
    path: {
      get: async () => ({ data: {} }),
    },
    global: {
      config: {
        get: async () => {
          events.push("migration")
          if (opts.fail) throw opts.fail
          return { data: opts.config ?? { model: "anthropic/claude-sonnet-4" } }
        },
        update: async () => {
          events.push("patch")
          return { data: {} }
        },
      },
    },
    app: {
      agents: async (args?: unknown) => {
        agentCalls.push(args)
        return { data: [{ name: "code" }] }
      },
    },
    project: {
      current: async () => ({ data: {} }),
    },
  })
  let client: ReturnType<typeof make> | undefined
  const context = {
    globalState: {
      get: () => state,
      update: async (key: string, value: unknown) => {
        updates.push([key, value])
        if (key === "variantSelections") state = value
      },
    },
  }
  const connection = {
    connect: async (directory: string) => {
      events.push("connect")
      connections.push(directory)
      client = make()
    },
    getClient: () => {
      if (!client) throw new Error("Not connected")
      return client
    },
    onEventFiltered: () => () => undefined,
    onStateChange: () => () => undefined,
    onNotificationDismissed: () => () => undefined,
    onLanguageChanged: () => () => undefined,
    onProfileChanged: () => () => undefined,
    onMigrationComplete: () => () => undefined,
    onFavoritesChanged: () => () => undefined,
    onModelSelectorExpandedChanged: () => () => undefined,
    onClearPendingPrompts: () => () => undefined,
    registerDirectoryProvider: () => () => undefined,
    getServerInfo: () => ({ port: 12345 }),
    getServerConfig: () => ({ baseUrl: "http://127.0.0.1:12345", password: "test" }),
    getConnectionState: () => "connected" as const,
    getConnectionError: () => null,
  }
  const provider = new KiloProvider({} as never, connection as never, context as never)
  const internal = provider as unknown as Internals
  internal.webview = { postMessage: async () => true }
  internal.syncWebviewState = async () => {
    events.push("sync")
  }
  internal.flushPendingSessionRefresh = async () => {}
  internal.fetchAndSendProviders = async () => {}
  internal.fetchAndSendAgents = async () => {}
  internal.fetchAndSendSkills = async () => {}
  internal.fetchAndSendCommands = async () => {}
  internal.fetchAndSendConfig = async () => {
    events.push("fetch-config")
  }
  internal.fetchAndSendIndexingStatus = async () => {}
  internal.fetchAndSendNotifications = async () => {}
  internal.seedSessionStatusMap = async () => {}
  internal.checkConfigWarnings = async () => {}
  internal.recoverPendingPrompts = () => {}
  internal.memory = { fetch: async () => {} }
  return { internal, events, updates, agentCalls, connections }
}

describe("KiloProvider variant migration", () => {
  it("runs migration after connect and before initial synchronization", async () => {
    const ctx = setup()

    await ctx.internal.initializeConnection()

    expect(ctx.events.indexOf("connect")).toBeLessThan(ctx.events.indexOf("migration"))
    expect(ctx.events.indexOf("migration")).toBeLessThan(ctx.events.indexOf("sync"))
    expect(ctx.events.indexOf("migration")).toBeLessThan(ctx.events.indexOf("fetch-config"))
  })

  it("uses_the_connected_workspace_directory_for_migration_agent_enumeration", async () => {
    const ctx = setup()

    await ctx.internal.initializeConnection()

    expect(ctx.agentCalls).toEqual([{ directory: ctx.connections[0] }])
  })

  it("logs migration failure without failing provider connection", async () => {
    const failure = new Error("migration failed")
    const error = spyOn(console, "error").mockImplementation(() => {})
    const ctx = setup({ fail: failure })

    try {
      await ctx.internal.initializeConnection()

      expect(ctx.internal.connectionState).toBe("connected")
      expect(ctx.events).toContain("sync")
      expect(error).toHaveBeenCalledWith(
        "[Kilo New] KiloProvider: Failed to migrate saved variant selections:",
        failure,
      )
    } finally {
      error.mockRestore()
    }
  })

  it("clears variant selections when resetting all settings", async () => {
    const warning = spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Reset" as never)
    const ctx = setup()

    try {
      await ctx.internal.handleResetAllSettings()

      expect(ctx.updates).toContainEqual(["variantSelections", undefined])
    } finally {
      warning.mockRestore()
    }
  })
})
