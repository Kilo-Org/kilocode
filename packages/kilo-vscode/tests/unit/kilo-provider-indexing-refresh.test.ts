import { describe, expect, it } from "bun:test"
import type { Config } from "@kilocode/sdk/v2/client"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  currentSession: { id: string } | null
  reloadAfterAuthChange: () => Promise<void>
  handleUpdateConfig: (partial: Partial<Config>) => Promise<void>
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
  fetchAndSendIndexingStatus: () => Promise<void>
}

function createConnection() {
  let drains = 0
  const client = {
    global: {
      config: {
        update: async () => ({ data: {} }),
      },
    },
    config: {
      get: async () => ({ data: {} }),
    },
  }

  return {
    drains: () => drains,
    service: {
      drainPendingPrompts: async () => {
        drains += 1
      },
      getClient: () => client,
    },
  }
}

describe("KiloProvider indexing refresh", () => {
  it("reloadAfterAuthChange fetches config first, then indexing status", async () => {
    const provider = new KiloProvider({} as never, {} as never)
    const internal = provider as unknown as Internals
    const calls: string[] = []

    internal.fetchAndSendConfig = async () => {
      calls.push("config")
    }
    internal.fetchAndSendProviders = async () => {
      calls.push("providers")
    }
    internal.fetchAndSendAgents = async () => {
      calls.push("agents")
    }
    internal.fetchAndSendSkills = async () => {
      calls.push("skills")
    }
    internal.fetchAndSendCommands = async () => {
      calls.push("commands")
    }
    internal.fetchAndSendNotifications = async () => {
      calls.push("notifications")
    }
    internal.fetchAndSendIndexingStatus = async () => {
      calls.push("indexing")
    }

    await internal.reloadAfterAuthChange()

    expect(calls[0]).toBe("config")
    expect(calls.includes("indexing")).toBe(true)
  })

  it("handleUpdateConfig no longer eagerly fetches indexing status", async () => {
    const conn = createConnection()
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals

    let indexing = 0
    internal.connectionState = "connected"
    internal.fetchAndSendIndexingStatus = async () => {
      indexing += 1
    }

    await internal.handleUpdateConfig({})

    expect(conn.drains()).toBe(1)
    expect(indexing).toBe(0)
  })

  it("fetchAndSendIndexingStatus uses current session directory header", async () => {
    const worktree = "/repo/.kilo/.kilocode/worktrees/feature"
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
    const original = globalThis.fetch

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response(
        JSON.stringify({
          state: "Disabled",
          message: "Indexing is disabled in worktree sessions.",
          processedFiles: 0,
          totalFiles: 0,
          percent: 0,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }) as typeof fetch

    try {
      const provider = new KiloProvider(
        {} as never,
        {
          getClient: () => ({}) as never,
          getServerConfig: () => ({ baseUrl: "http://127.0.0.1:9999", password: "secret" }),
        } as never,
      )
      const internal = provider as unknown as Internals
      provider.setSessionDirectory("ses_worktree", worktree)
      internal.currentSession = { id: "ses_worktree" }

      await internal.fetchAndSendIndexingStatus()

      expect(calls.length).toBe(1)
      const headers = new Headers(calls[0]?.init?.headers)
      const auth = Buffer.from("kilo:secret").toString("base64")
      expect(headers.get("Authorization")).toBe(`Basic ${auth}`)
      expect(headers.get("x-kilo-directory")).toBe(worktree)
    } finally {
      globalThis.fetch = original
    }
  })
})
