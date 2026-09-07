import { describe, expect, it } from "bun:test"
import type { Config } from "@kilocode/sdk/v2/client"
import { indexingConsentStore, type IndexingProject } from "../../src/indexing-consent"
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
  fetchAndSendIndexingStatus: (directory?: string, projectId?: string) => Promise<void>
  sendIndexingSettings: (projectId?: string) => Promise<IndexingProject | undefined>
  setIndexingConsent: (projectId: string, enabled: boolean) => Promise<void>
  initializeConnection: () => Promise<void>
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

const initial = {
  state: "In Progress",
  message: "Indexing is initializing.",
  processedFiles: 0,
  totalFiles: 0,
  percent: 0,
}

const complete = {
  state: "Complete",
  message: "Index up-to-date.",
  processedFiles: 100,
  totalFiles: 100,
  percent: 100,
}

function indexing(dir = "/repo", root = dir) {
  const context = { globalState: { get: () => undefined, update: async () => {} } }
  const store = indexingConsentStore(context as never)
  store.project = async () => ({ id: "prj-test", root, label: "Project" })
  const client = {
    kilo: { profile: async () => ({ data: null }) },
    config: { warnings: async () => ({ data: [] }) },
  }
  const service = {
    getClient: () => client,
    getServerConfig: () => ({ baseUrl: "http://127.0.0.1:9999", password: "secret" }),
    getServerInfo: () => null,
    getConnectionError: () => null,
    resolveEventSessionId: () => undefined,
  }
  const provider = new KiloProvider({} as never, service as never, context as never)
  const internal = provider as unknown as Internals
  const messages: Array<Record<string, unknown>> = []
  provider.postMessage = (message) => void messages.push(message as Record<string, unknown>)
  provider.setSessionDirectory("ses_indexing", dir)
  internal.currentSession = { id: "ses_indexing" }
  return { internal, client, service, messages, store }
}

describe("KiloProvider indexing refresh", () => {
  it("shares snapshot payloads across load, SSE refresh, and post-save refresh", async () => {
    const conn = createConnection()
    const settings = () => ({
      maxCost: 0,
      languageCommitMessage: "sync",
      multiProject: false,
      browserAutomation: false,
      "agentManager.autoBranchNaming": true,
      "agentManager.branchPrefix": "",
    })
    const snapshot = await fetchSnapshot(conn.client as never, "/repo", settings)
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals
    const sent: Array<Record<string, unknown>> = []
    provider.postMessage = (message) => void sent.push(message as Record<string, unknown>)
    Object.assign(internal, { connectionState: "connected", configSettings: settings })
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

  it("reloadAfterAuthChange refreshes providers immediately but waits for config before indexing", async () => {
    const provider = new KiloProvider({} as never, {} as never)
    const internal = provider as unknown as Internals
    const calls: string[] = []
    const config = Promise.withResolvers<void>()

    internal.fetchAndSendConfig = async () => {
      calls.push("config")
      await config.promise
      calls.push("configured")
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

    const pending = internal.reloadAfterAuthChange()
    try {
      expect(calls).toContain("providers")
      expect(calls).toContain("config")
      expect(calls).not.toContain("indexing")
    } finally {
      config.resolve()
      await pending
    }

    expect(calls.indexOf("indexing")).toBeGreaterThan(calls.indexOf("configured"))
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

  it.each(["/repo/.kilo/.kilocode/worktrees/feature", "/home/user/桌面/project", "/repo/100%/%2F/project"])(
    "fetchAndSendIndexingStatus writes consent with an encoded directory header: %s",
    async (dir) => {
      const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
      const original = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ input, init })
        return Response.json(initial)
      }) as typeof fetch

      try {
        await indexing(dir).internal.fetchAndSendIndexingStatus()

        expect(calls).toHaveLength(1)
        const call = calls.at(0)
        const headers = new Headers(call?.init?.headers)
        const auth = Buffer.from("kilo:secret").toString("base64")
        expect(headers.get("Authorization")).toBe(`Basic ${auth}`)
        expect(headers.get("x-kilo-directory")).toBe(encodeURIComponent(dir))
        expect(decodeURIComponent(headers.get("x-kilo-directory") ?? "")).toBe(dir)
        expect(call?.init?.method).toBe("PUT")
        expect(String(call?.input)).toBe("http://127.0.0.1:9999/indexing/consent")
        expect(JSON.parse(String(call?.init?.body))).toEqual({ enabled: false })
      } finally {
        globalThis.fetch = original
      }
    },
  )

  it("keeps newer indexing.status when an older HTTP status response arrives", async () => {
    const fixture = indexing()
    const called = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    globalThis.fetch = (() => {
      called.resolve()
      return response.promise
    }) as typeof fetch

    const request = fixture.internal.fetchAndSendIndexingStatus()
    try {
      await called.promise
      fixture.internal.handleEvent({ type: "indexing.status", properties: { status: complete } }, "/repo")
      response.resolve(Response.json(initial))
      await request

      expect(fixture.messages).toEqual([expect.objectContaining({ type: "indexingStatusLoaded", status: complete })])
    } finally {
      response.resolve(Response.json(initial))
      await request
      globalThis.fetch = original
    }
  })

  it("keeps the Disabled consent response when progress arrives during the request", async () => {
    const fixture = indexing()
    const project = await fixture.store.project("/repo")
    fixture.store.list = async () => [project]
    const disabled = { ...initial, state: "Disabled", message: "Indexing consent is required." }
    const called = Promise.withResolvers<RequestInit | undefined>()
    const response = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      called.resolve(init)
      return response.promise
    }) as typeof fetch

    const request = fixture.internal.setIndexingConsent(project.id, false)
    try {
      const init = await called.promise
      expect(JSON.parse(String(init?.body))).toEqual({ enabled: false })
      fixture.internal.handleEvent({ type: "indexing.status", properties: { status: initial } }, project.root)
      response.resolve(Response.json(disabled))
      await request

      expect(fixture.messages.filter((message) => message.type === "indexingStatusLoaded")).toEqual([
        expect.objectContaining({ status: initial, projectId: project.id }),
        expect.objectContaining({ status: disabled, projectId: project.id }),
      ])
    } finally {
      response.resolve(Response.json(disabled))
      await request
      globalThis.fetch = original
    }
  })

  it("applies a delayed consent save without replacing or invalidating the selected project status", async () => {
    const fixture = indexing()
    const project = await fixture.store.project("/repo")
    const prior = { id: "prj-other", root: "/other-repo", label: "Other" }
    const projects = [prior, project]
    const waiting = Promise.withResolvers<void>()
    const listing = Promise.withResolvers<IndexingProject[]>()
    let lists = 0
    fixture.store.list = async () => {
      if (++lists !== 2) return projects
      waiting.resolve()
      return listing.promise
    }
    const called = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const calls: Array<{ directory: string; enabled: boolean }> = []
    const original = globalThis.fetch
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      const directory = decodeURIComponent(new Headers(init?.headers).get("x-kilo-directory") ?? "")
      calls.push({ directory, enabled: JSON.parse(String(init?.body)).enabled })
      if (directory === prior.root) return Promise.resolve(Response.json(initial))
      called.resolve()
      return response.promise
    }) as typeof fetch

    const saving = fixture.internal.setIndexingConsent(prior.id, true)
    let request: Promise<void> | undefined
    try {
      await waiting.promise
      await fixture.internal.sendIndexingSettings(project.id)
      request = fixture.internal.fetchAndSendIndexingStatus(project.root, project.id)
      await called.promise
      listing.resolve(projects)
      await saving
      expect(calls).toEqual([
        { directory: project.root, enabled: false },
        { directory: prior.root, enabled: true },
      ])
      response.resolve(Response.json(initial))
      await request
      fixture.internal.handleEvent({ type: "indexing.status", properties: { status: complete } }, project.root)

      expect(fixture.messages.filter((message) => message.type === "indexingStatusLoaded")).toEqual([
        expect.objectContaining({ status: initial, projectId: project.id }),
        expect.objectContaining({ status: complete, projectId: project.id }),
      ])
    } finally {
      listing.resolve(projects)
      response.resolve(Response.json(initial))
      await Promise.all([saving, request])
      globalThis.fetch = original
    }
  })

  it("accepts the resolved project root and rejects unrelated indexing.status events from a repo subfolder", async () => {
    const fixture = indexing("/repo/subfolder", "/repo")
    const original = globalThis.fetch
    globalThis.fetch = (async () => Response.json(initial)) as typeof fetch

    try {
      await fixture.internal.fetchAndSendIndexingStatus(undefined, "prj-test")
      const event = { type: "indexing.status", properties: { status: complete } }
      fixture.internal.handleEvent(event, "/other-repo")
      expect(fixture.messages).toHaveLength(1)

      fixture.internal.handleEvent(event, "/repo")
      expect(fixture.messages).toEqual([
        expect.objectContaining({ type: "indexingStatusLoaded", status: initial, projectId: "prj-test" }),
        expect.objectContaining({ type: "indexingStatusLoaded", status: complete, projectId: "prj-test" }),
      ])
    } finally {
      globalThis.fetch = original
    }
  })

  it("refreshes indexing on SSE reconnect without waiting for profile", async () => {
    const fixture = indexing()
    const callback = Promise.withResolvers<(state: Internals["connectionState"]) => Promise<void>>()
    const subscribe = () => () => {}
    Object.assign(fixture.service, {
      connect: async () => {},
      getClient: () => null,
      getConnectionState: () => "disconnected",
      onEventFiltered: subscribe,
      onStateChange: (listener: (state: Internals["connectionState"]) => Promise<void>) => {
        callback.resolve(listener)
        return () => {}
      },
      onNotificationDismissed: subscribe,
      onLanguageChanged: subscribe,
      onProfileChanged: subscribe,
      onFavoritesChanged: subscribe,
      onModelSelectorExpandedChanged: subscribe,
      onClearPendingPrompts: subscribe,
      registerDirectoryProvider: subscribe,
    })
    await fixture.internal.initializeConnection()
    expect(fixture.internal.connectionState).toBe("disconnected")

    const profile = Promise.withResolvers<{ data: null }>()
    const calls: string[] = []
    fixture.service.getClient = () => fixture.client
    fixture.client.kilo.profile = () => profile.promise
    fixture.internal.fetchAndSendIndexingStatus = async () => {
      calls.push("indexing")
    }

    const syncing = (await callback.promise)("connected")
    try {
      expect(calls).toEqual(["indexing"])
    } finally {
      profile.resolve({ data: null })
      await syncing
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
