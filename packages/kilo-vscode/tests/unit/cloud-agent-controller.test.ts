import { afterEach, describe, expect, it } from "bun:test"
import type { GlobalEvent, KiloClient, Session } from "@kilocode/sdk/v2/client"
import { CloudAgentController, cloudDirectory } from "../../src/agent-manager/cloud-agent/controller"
import type { CloudAgentStartInput, CloudAgentStartResult } from "../../src/agent-manager/cloud-agent/start"

const CREATED = "2026-06-17T10:00:00.000Z"
const UPDATED = "2026-06-17T10:01:00.000Z"

type ControllerOptions = ConstructorParameters<typeof CloudAgentController>[0]
type RequestOptions = { signal?: AbortSignal; onSseEvent?: (event?: unknown) => void }
type FacadeOptions = {
  get?: (params: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ data?: Session }>
  messages?: (params: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ data?: unknown[] }>
  prompt?: (params: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>
  abort?: (params: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>
  event?: (options: RequestOptions, attempt: number) => Promise<{ stream: AsyncIterable<GlobalEvent> }>
}
type LocalOptions = {
  rows?: ReturnType<typeof row>[]
  credentialsError?: unknown
  listError?: unknown
}

function session(id = "ses_cloud"): Session {
  return {
    id,
    slug: id,
    projectID: "cloud",
    directory: cloudDirectory(id),
    title: "Cloud run",
    version: "1",
    time: { created: Date.parse(CREATED), updated: Date.parse(UPDATED) },
  }
}

function row(id = "ses_cloud") {
  return {
    session_id: id,
    title: "Cloud run",
    created_at: CREATED,
    updated_at: UPDATED,
    version: 1,
  }
}

function transcript(id = "ses_cloud") {
  return {
    info: {
      id: "msg_1",
      sessionID: id,
      role: "user",
      time: { created: Date.parse(CREATED) },
      agent: "code",
      model: { providerID: "kilo", modelID: "kilo-auto" },
    },
    parts: [{ id: "part_1", sessionID: id, messageID: "msg_1", type: "text", text: "hello" }],
  }
}

function started(): CloudAgentStartResult {
  return {
    cloudAgentSessionId: "cloud_1",
    kiloSessionId: "ses_created",
    messageId: "msg_1",
    delivery: "queued",
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function settle(turns = 4) {
  for (let turn = 0; turn < turns; turn++) await Bun.sleep(0)
}

function empty() {
  return (async function* () {})()
}

function hold(signal?: AbortSignal) {
  return (async function* () {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve()
        return
      }
      signal?.addEventListener("abort", () => resolve(), { once: true })
    })
  })()
}

function stream(items: GlobalEvent[], signal?: AbortSignal) {
  return (async function* () {
    for (const item of items) yield item
    yield* hold(signal)
  })()
}

function delta(id: string, text: string): GlobalEvent {
  return {
    directory: cloudDirectory(id),
    payload: {
      id: `evt_${id}`,
      type: "message.part.delta",
      properties: {
        sessionID: id,
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: text,
      },
    },
  }
}

function interactive(id: string): GlobalEvent {
  return {
    directory: cloudDirectory(id),
    payload: {
      id: "evt_permission",
      type: "permission.asked",
      properties: { sessionID: id },
    },
  } as GlobalEvent
}

function local(options: LocalOptions = {}) {
  const calls = {
    credentials: 0,
    list: [] as Array<{ params: unknown; options: unknown }>,
    profile: 0,
  }
  const client = {
    kilo: {
      profile: async () => {
        calls.profile++
        return {
          data: {
            profile: { name: "Cloud Coder", email: "coder@example.com", organizations: [] },
            currentOrgId: null,
          },
        }
      },
      cloudAgent: {
        credentials: async () => {
          calls.credentials++
          if (options.credentialsError) throw options.credentialsError
          return {
            data: {
              token: "secret",
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              kiloFacadeUrl: "https://cloud.example/kilo",
              cloudAgentUrl: "https://cloud.example",
            },
          }
        },
      },
      cloudSessions: async (params: unknown, request: unknown) => {
        calls.list.push({ params, options: request })
        if (options.listError) throw options.listError
        return { data: { cliSessions: options.rows ?? [], nextCursor: null } }
      },
    },
  } as unknown as KiloClient
  return { client, calls }
}

function facade(options: FacadeOptions = {}) {
  const calls = {
    get: [] as Array<{ params: Record<string, unknown>; options: Record<string, unknown> }>,
    messages: [] as Array<{ params: Record<string, unknown>; options: Record<string, unknown> }>,
    prompt: [] as Array<{ params: Record<string, unknown>; options: Record<string, unknown> }>,
    abort: [] as Array<{ params: Record<string, unknown>; options: Record<string, unknown> }>,
    streams: 0,
  }
  const client = {
    session: {
      get: async (params: Record<string, unknown>, request: Record<string, unknown>) => {
        calls.get.push({ params, options: request })
        return options.get?.(params, request) ?? { data: session(String(params.sessionID)) }
      },
      messages: async (params: Record<string, unknown>, request: Record<string, unknown>) => {
        calls.messages.push({ params, options: request })
        return options.messages?.(params, request) ?? { data: [] }
      },
      promptAsync: async (params: Record<string, unknown>, request: Record<string, unknown>) => {
        calls.prompt.push({ params, options: request })
        return options.prompt?.(params, request) ?? { data: undefined }
      },
      abort: async (params: Record<string, unknown>, request: Record<string, unknown>) => {
        calls.abort.push({ params, options: request })
        return options.abort?.(params, request) ?? { data: true }
      },
    },
    global: {
      event: async (request: RequestOptions) => {
        calls.streams++
        return options.event?.(request, calls.streams) ?? { stream: hold(request.signal) }
      },
    },
  } as unknown as KiloClient
  return { client, calls }
}

const active: CloudAgentController[] = []

afterEach(() => {
  for (const cloud of active.splice(0)) cloud.dispose()
})

function setup(
  input: {
    local?: ReturnType<typeof local>
    facade?: ReturnType<typeof facade>
    startAgent?: (options: {
      url: string
      token: string
      input: CloudAgentStartInput
    }) => Promise<CloudAgentStartResult>
    wait?: (ms: number, signal: AbortSignal) => Promise<void>
  } = {},
) {
  const posts: unknown[] = []
  const localApi = input.local ?? local()
  const remote = input.facade ?? facade()
  const clients: unknown[] = []
  const cloud = new CloudAgentController({
    getLocalClient: () => localApi.client,
    getRoot: () => "/workspace",
    remoteUrl: async () => "git@github.com:Kilo-Org/kilocode.git",
    post: (message) => posts.push(message),
    log: () => {},
    createClient: ((options: unknown) => {
      clients.push(options)
      return remote.client
    }) as NonNullable<ControllerOptions["createClient"]>,
    ...(input.startAgent ? { startAgent: input.startAgent } : {}),
    ...(input.wait ? { wait: input.wait } : {}),
  })
  cloud.attach()
  active.push(cloud)
  return { cloud, posts, local: localApi, remote, clients }
}

function type(item: unknown) {
  return (item as { type?: string }).type
}

describe("CloudAgentController MVP", () => {
  describe("discovery and creation", () => {
    it("lists repository-filtered sessions through the local SDK without opening SSE", async () => {
      const api = local({ rows: [row("ses_listed")] })
      const ctx = setup({ local: api })

      ctx.cloud.requestList()
      await settle()

      expect(api.calls.list).toEqual([
        {
          params: { gitUrl: "https://github.com/kilo-org/kilocode", limit: 100 },
          options: { throwOnError: true },
        },
      ])
      expect(ctx.posts).toEqual([
        { type: "agentManager.cloudSessions", status: "loading", sessions: [] },
        {
          type: "agentManager.cloudSessions",
          status: "ready",
          sessions: [{ id: "ses_listed", title: "Cloud run", createdAt: CREATED, updatedAt: UPDATED }],
          repository: "Kilo-Org/kilocode",
        },
      ])
      expect(ctx.clients).toEqual([])
      expect(ctx.remote.calls.streams).toBe(0)
    })

    it("reports signed-out discovery without calling the session list", async () => {
      const api = local({ credentialsError: { status: 401 } })
      const ctx = setup({ local: api })

      ctx.cloud.requestList()
      await settle()

      expect(api.calls.list).toEqual([])
      expect(ctx.posts.map(type)).toEqual(["agentManager.cloudSessions", "agentManager.cloudSessions"])
      expect(ctx.posts.at(-1)).toEqual({
        type: "agentManager.cloudSessions",
        status: "signed-out",
        sessions: [],
      })
    })

    it("starts with the exact payload and posts an optimistic created tab before hydration", async () => {
      const starts: Array<{ url: string; token: string; input: CloudAgentStartInput }> = []
      const ctx = setup({
        startAgent: async (options) => {
          starts.push(options)
          return started()
        },
      })

      expect(
        ctx.cloud.handle({
          type: "agentManager.createCloudSession",
          prompt: " Fix it ",
          mode: " code ",
          model: " kilo-auto ",
        }),
      ).toBe(true)
      await settle()

      expect(starts).toEqual([
        {
          url: "https://cloud.example",
          token: "secret",
          input: {
            message: { prompt: "Fix it" },
            agent: { mode: "code", model: "kilo-auto" },
            repository: { type: "github", repo: "Kilo-Org/kilocode" },
            options: { createdOnPlatform: "agent-manager" },
          },
        },
      ])
      expect(ctx.posts).toContainEqual({
        type: "agentManager.cloudSessionCreated",
        session: {
          id: "ses_created",
          title: "Cloud Agent session",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      })
      expect(ctx.cloud.owns("ses_created")).toBe(true)
      expect(ctx.remote.calls.get).toEqual([])
      expect(ctx.remote.calls.messages).toEqual([])
      expect(ctx.remote.calls.prompt).toEqual([])
    })
  })

  describe("snapshot and actions", () => {
    it("hydrates detail and a bounded transcript without requesting session status", async () => {
      const remote = facade({
        messages: async () => ({ data: [transcript()] }),
      })
      const ctx = setup({ facade: remote })
      ctx.cloud.open("ses_cloud")

      expect(ctx.cloud.handle({ type: "loadMessages", sessionID: "ses_cloud" })).toBe(true)
      await settle()

      expect(remote.calls.get).toEqual([
        {
          params: { sessionID: "ses_cloud", directory: cloudDirectory("ses_cloud") },
          options: { throwOnError: true },
        },
      ])
      expect(remote.calls.messages).toEqual([
        {
          params: { sessionID: "ses_cloud", directory: cloudDirectory("ses_cloud"), limit: 100 },
          options: { throwOnError: true },
        },
      ])
      expect("status" in (remote.client.session as object)).toBe(false)
      expect(ctx.posts.map(type)).toEqual(["sessionUpdated", "messagesLoaded"])
      expect(ctx.posts.at(-1)).toEqual({
        type: "messagesLoaded",
        sessionID: "ses_cloud",
        messages: [
          expect.objectContaining({ id: "msg_1", role: "user", parts: [expect.objectContaining({ text: "hello" })] }),
        ],
        mode: "replace",
        hasMore: false,
      })
    })

    it("sends plain text without model, mode, or agent overrides", async () => {
      const ctx = setup()
      ctx.cloud.open("ses_cloud")

      expect(
        ctx.cloud.handle({
          type: "sendMessage",
          sessionID: "ses_cloud",
          messageID: "msg_followup",
          text: "continue",
          providerID: "kilo",
          modelID: "ignored-model",
          agent: "ignored-agent",
          variant: "ignored-variant",
        }),
      ).toBe(true)
      await settle()

      expect(ctx.remote.calls.prompt).toEqual([
        {
          params: {
            sessionID: "ses_cloud",
            directory: cloudDirectory("ses_cloud"),
            messageID: "msg_followup",
            parts: [{ type: "text", text: "continue" }],
          },
          options: { throwOnError: true },
        },
      ])
    })

    it("rejects and restores attachment, draft, and slash-command inputs", async () => {
      const ctx = setup()
      ctx.cloud.open("ses_cloud")
      const files = [{ mime: "image/png", url: "data:image/png;base64,abc", filename: "image.png" }]

      ctx.cloud.handle({
        type: "sendMessage",
        sessionID: "ses_cloud",
        messageID: "msg_file",
        text: "inspect this",
        files,
      })
      ctx.cloud.handle({
        type: "sendMessage",
        sessionID: "ses_cloud",
        messageID: "msg_draft",
        draftID: "draft_1",
        text: "draft text",
      })
      ctx.cloud.handle({
        type: "sendCommand",
        sessionID: "ses_cloud",
        messageID: "msg_command",
        command: "review",
        arguments: "now",
      })
      await settle()

      expect(ctx.remote.calls.prompt).toEqual([])
      expect(ctx.posts).toEqual([
        {
          type: "sendMessageFailed",
          error: "Cloud Agent follow-ups currently support plain text only",
          text: "inspect this",
          sessionID: "ses_cloud",
          draftID: undefined,
          messageID: "msg_file",
          files,
        },
        {
          type: "sendMessageFailed",
          error: "Cloud Agent follow-ups currently support plain text only",
          text: "draft text",
          sessionID: "ses_cloud",
          draftID: "draft_1",
          messageID: "msg_draft",
          files: undefined,
        },
        {
          type: "sendMessageFailed",
          error: "Cloud Agent slash commands are not supported yet",
          text: "/review now",
          sessionID: "ses_cloud",
          draftID: undefined,
          messageID: "msg_command",
          files: undefined,
        },
      ])
    })

    it("aborts the remote cloud session", async () => {
      const ctx = setup()
      ctx.cloud.open("ses_cloud")

      expect(ctx.cloud.handle({ type: "abort", sessionID: "ses_cloud" })).toBe(true)
      await settle()

      expect(ctx.remote.calls.abort).toEqual([
        {
          params: { sessionID: "ses_cloud", directory: cloudDirectory("ses_cloud") },
          options: { throwOnError: true },
        },
      ])
    })
  })

  describe("stream lifecycle", () => {
    it("routes events only for open sessions", async () => {
      const remote = facade({
        event: async (options) => ({
          stream: stream([delta("ses_cloud", "open"), delta("ses_closed", "closed")], options.signal),
        }),
      })
      const ctx = setup({ facade: remote })

      ctx.cloud.open("ses_cloud")
      await settle()

      expect(ctx.posts).toEqual([
        {
          type: "partUpdated",
          sessionID: "ses_cloud",
          messageID: "msg_1",
          part: { id: "part_1", type: "text", messageID: "msg_1", text: "open" },
          delta: { type: "text-delta", textDelta: "open" },
        },
      ])
    })

    it("relocks on reconnect and hydrates with detail and messages before resuming", async () => {
      const retry = deferred<void>()
      const remote = facade({
        messages: async () => ({ data: [transcript()] }),
        event: async (options, attempt) => {
          if (attempt === 1) return { stream: empty() }
          options.onSseEvent?.()
          return { stream: hold(options.signal) }
        },
      })
      const ctx = setup({ facade: remote, wait: async () => retry.promise })

      ctx.cloud.open("ses_cloud")
      await settle()

      expect(ctx.posts).toContainEqual({
        type: "agentManager.cloudSessionsPending",
        sessionIDs: ["ses_cloud"],
      })
      expect(remote.calls.get).toEqual([])
      expect(remote.calls.messages).toEqual([])

      retry.resolve(undefined)
      await settle(8)

      expect(remote.calls.streams).toBe(2)
      expect(remote.calls.get).toHaveLength(1)
      expect(remote.calls.messages).toHaveLength(1)
      expect(remote.calls.messages[0]?.params).toMatchObject({ limit: 100 })
      const pending = ctx.posts.findIndex((item) => type(item) === "agentManager.cloudSessionsPending")
      const loaded = ctx.posts.findIndex((item) => type(item) === "messagesLoaded")
      expect(pending).toBeGreaterThanOrEqual(0)
      expect(loaded).toBeGreaterThan(pending)
      expect(ctx.posts.map(type)).not.toContain("sessionStatus")
    })

    it("aborts an unsupported interactive request and explains why", async () => {
      const remote = facade({
        event: async (options) => ({ stream: stream([interactive("ses_cloud")], options.signal) }),
      })
      const ctx = setup({ facade: remote })

      ctx.cloud.open("ses_cloud")
      await settle()

      expect(remote.calls.abort).toEqual([
        {
          params: { sessionID: "ses_cloud", directory: cloudDirectory("ses_cloud") },
          options: { throwOnError: true },
        },
      ])
      expect(ctx.posts).toEqual([
        {
          type: "error",
          sessionID: "ses_cloud",
          message: "Cloud Agent session stopped because interactive requests are not supported in VS Code yet.",
        },
      ])
    })
  })
})
