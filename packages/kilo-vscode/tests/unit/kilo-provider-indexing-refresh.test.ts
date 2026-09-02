import { describe, expect, it } from "bun:test"
import type { Config } from "@kilocode/sdk/v2/client"
import { fetchSnapshot } from "../../src/kilo-provider/config-snapshot"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  currentSession: { id: string } | null
  cachedIndexingStatusMessage: unknown
  handleEvent: (event: unknown, directory?: string) => void
  reloadAfterAuthChange: () => Promise<void>
  handleUpdateConfig: (
    partial: Partial<Config>,
    project?: Partial<Config>,
    globalUnset?: string[][],
    projectUnset?: string[][],
  ) => Promise<void>
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendConfigUpdated: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
  fetchAndSendIndexingStatus: () => Promise<void>
  connectionGeneration: number
  configBindings: {
    create: (input: unknown) => { id: string }
  }
}

function binding(internal: Internals, scope: "global" | "project") {
  return internal.configBindings.create({
    connection: internal.connectionGeneration,
    scope,
    directory: "/repo",
    target: {
      scope,
      path: scope === "global" ? "/config/kilo.jsonc" : "/repo/.kilo/kilo.jsonc",
      revision: `${scope}-revision`,
      exists: false,
      writable: true,
      raw: {},
    },
  })
}

function createConnection() {
  let drains = 0
  const patches: unknown[] = []
  const snapshot = {
    effective: {},
    targets: {
      global: {
        scope: "global",
        path: "/config/kilo.jsonc",
        revision: "global-next",
        exists: true,
        writable: true,
        raw: {},
      },
      project: {
        scope: "project",
        path: "/repo/.kilo/kilo.jsonc",
        revision: "project-next",
        exists: true,
        writable: true,
        raw: {},
      },
    },
  }
  const client = {
    global: {
      config: {
        get: async () => ({ data: {} }),
        update: async () => ({ data: {} }),
      },
    },
    config: {
      get: async () => ({ data: {} }),
      update: async () => ({ data: {} }),
      overlay: async () => ({ data: { project: {}, targets: snapshot.targets } }),
      overlayUpdate: async (patch: unknown) => {
        patches.push(patch)
        return { data: snapshot }
      },
    },
    experimental: {
      capabilities: {
        get: async () => ({ data: { backgroundSubagents: true } }),
      },
    },
  }

  return {
    client,
    drains: () => drains,
    patches: () => patches,
    service: {
      drainPendingPrompts: async () => {
        drains += 1
      },
      getClient: () => client,
    },
  }
}

describe("KiloProvider indexing refresh", () => {
  it("shares snapshot payloads across load, SSE refresh, and post-save refresh", async () => {
    const conn = createConnection()
    const settings = () => ({
      maxCost: 0,
      languageCommitMessage: "sync",
      multiProject: false,
      browserAutomation: false,
    })
    const snapshot = await fetchSnapshot(conn.client as never, "/repo", settings)
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals
    const sent: Array<Record<string, unknown>> = []
    provider.postMessage = (message) => void sent.push(message as Record<string, unknown>)
    Object.assign(internal, { connectionState: "connected", commitMessageLanguageSetting: () => "sync" })
    await internal.fetchAndSendConfig()
    await internal.fetchAndSendConfigUpdated()
    // Save against the binding the latest config load issued, like the webview
    // does: each load supersedes older bindings for the same scope+directory.
    const issued = (sent[sent.length - 1]!.bindings as { global: { id: string } }).global.id
    await internal.handleUpdateConfig({ model: "test/global" }, {}, [], [], issued)

    // bindings carry fresh per-load revision state, so compare the payload
    // without them; each message still must carry a bindings object.
    const strip = (m: Record<string, unknown>) => {
      const { bindings, ...rest } = m
      expect(bindings).toMatchObject({ global: expect.anything() })
      return rest
    }
    const payload = {
      config: snapshot.config,
      globalConfig: snapshot.targets!.global.raw,
      projectConfig: snapshot.targets!.project.raw,
      settings: snapshot.settings,
      features: snapshot.features,
    }
    expect(sent.map(strip)).toEqual([
      { type: "configLoaded", ...payload },
      { type: "configUpdated", ...payload },
      { type: "configUpdated", ...payload },
    ])
  })

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

    expect(conn.drains()).toBe(0)
    expect(indexing).toBe(0)
  })

  it("refreshes providers when prompt-training model visibility changes", async () => {
    const conn = createConnection()
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals
    let calls = 0
    internal.connectionState = "connected"
    internal.fetchAndSendProviders = async () => {
      calls += 1
    }
    const global = binding(internal, "global")

    await internal.handleUpdateConfig({ hide_prompt_training_models: true }, {}, [], [], global.id)

    expect(calls).toBe(1)
  })

  it("passes scoped unset paths to the config overlay endpoint", async () => {
    const conn = createConnection()
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals
    internal.connectionState = "connected"
    const global = binding(internal, "global")
    const project = binding(internal, "project")

    await internal.handleUpdateConfig(
      { indexing: { qdrant: { apiKey: undefined } } },
      { indexing: { searchMinScore: undefined } },
      [["indexing", "qdrant", "apiKey"]],
      [["indexing", "searchMinScore"]],
      global.id,
      project.id,
    )

    expect(conn.patches()).toEqual([
      expect.objectContaining({
        scope: "global",
        expected: { path: "/config/kilo.jsonc", revision: "global-revision" },
        set: { indexing: { qdrant: { apiKey: undefined } } },
        unset: [["indexing", "qdrant", "apiKey"]],
      }),
      expect.objectContaining({
        scope: "project",
        expected: { path: "/repo/.kilo/kilo.jsonc", revision: "project-revision" },
        set: { indexing: { searchMinScore: undefined } },
        unset: [["indexing", "searchMinScore"]],
      }),
    ])
  })

  it("reports a completed global scope when the project write conflicts", async () => {
    const target = (scope: "global" | "project", revision: string) => ({
      scope,
      path: scope === "global" ? "/config/kilo.jsonc" : "/repo/.kilo/kilo.jsonc",
      revision,
      exists: true,
      writable: true,
      raw: {},
    })
    const snapshot = {
      effective: { model: "test/global" },
      targets: { global: target("global", "global-next"), project: target("project", "project-revision") },
    }
    const client = {
      config: {
        overlayUpdate: async (input: { scope: string }) => {
          if (input.scope === "project") throw new Error("revision conflict")
          return { data: snapshot }
        },
      },
    }
    const provider = new KiloProvider(
      {} as never,
      { drainPendingPrompts: async () => {}, getClient: () => client } as never,
    )
    const internal = provider as unknown as Internals
    const messages: Array<Record<string, unknown>> = []
    provider.postMessage = (message) => messages.push(message as Record<string, unknown>)
    internal.connectionState = "connected"
    const global = binding(internal, "global")
    const project = binding(internal, "project")

    await internal.handleUpdateConfig(
      { model: "test/global" },
      { model: "test/project" },
      [],
      [],
      global.id,
      project.id,
    )

    expect(messages.find((message) => message.type === "configUpdateFailed")).toMatchObject({
      completedScopes: ["global"],
      config: snapshot.effective,
      bindings: { global: { target: snapshot.targets.global }, project: { target: snapshot.targets.project } },
    })
  })

  it("fetchAndSendIndexingStatus writes project consent through the dedicated endpoint", async () => {
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
        {
          globalState: {
            get: () => undefined,
            update: async () => {},
          },
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
      expect(calls[0]?.init?.method).toBe("PUT")
      expect(String(calls[0]?.input)).toBe("http://127.0.0.1:9999/indexing/consent")
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ enabled: false })
    } finally {
      globalThis.fetch = original
    }
  })

  it("forwards indexing.status when directory only differs by Windows drive casing", () => {
    const provider = new KiloProvider(
      {} as never,
      {
        resolveEventSessionId: () => undefined,
      } as never,
    )
    const internal = provider as unknown as Internals
    provider.setSessionDirectory("ses_worktree", "C:/Repo/Work")
    internal.currentSession = { id: "ses_worktree" }

    const desc = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    try {
      internal.handleEvent(
        {
          type: "indexing.status",
          properties: {
            status: {
              state: "Complete",
              message: "Done",
              processedFiles: 10,
              totalFiles: 10,
              percent: 100,
            },
          },
        },
        "c:/repo/work",
      )
    } finally {
      if (desc) Object.defineProperty(process, "platform", desc)
    }

    const msg = internal.cachedIndexingStatusMessage as { type?: string; status?: { state?: string } } | undefined
    expect(msg?.type).toBe("indexingStatusLoaded")
    expect(msg?.status?.state).toBe("Complete")
  })
})
