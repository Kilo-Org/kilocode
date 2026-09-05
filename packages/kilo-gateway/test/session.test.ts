import { expect, test } from "bun:test"
import type { RpcCallContext, RpcHandlers } from "@opencode-ai/plugin/effect/rpc"
import { Credential } from "@opencode-ai/schema/credential"
import { IntegrationMethodID } from "@opencode-ai/schema/integration-id"
import { KiloSession } from "@opencode-ai/schema/kilocode/session"
import { Location } from "@opencode-ai/schema/location"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { SessionTransfer } from "@opencode-ai/schema/session-transfer"
import { Effect, Schema } from "effect"
import { registerSessions, type SessionContext, type SessionServices } from "../src/session.js"

const decodeTransfer = Schema.decodeUnknownSync(SessionTransfer.Data)
const encodeTransfer = Schema.encodeSync(SessionTransfer.Data)
const methodID = IntegrationMethodID.make("device")
const shareToken = "fixture.payload.signature"
const shareURL = `https://app.kilo.ai/s/${shareToken}`

function transfer() {
  return decodeTransfer({
    info: {
      id: "ses_source",
      parentID: "ses_parent",
      fork: { sessionID: "ses_parent", boundary: { type: "through", messageID: "msg_source" } },
      projectID: "source",
      cost: 0,
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      time: { created: 1, updated: 2, idle: 2, viewed: 2 },
      title: "Shared session",
      location: { directory: "/source" },
      revert: { messageID: "msg_source" },
    },
    messages: [
      { id: "msg_source", type: "user", text: "hello", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { providerID: "kilo", id: "fixture" },
        content: [{ type: "text", text: "hello back" }],
        snapshot: { start: "source-tree-start", end: "source-tree-end", files: ["source.ts"] },
        time: { created: 2, completed: 3 },
      },
    ],
  })
}

function harness(services?: SessionServices) {
  const storage = new Map<string, Schema.Json>()
  const rpc: { handlers?: RpcHandlers<typeof KiloSession.Definition> } = {}
  const credential = Credential.OAuth.make({
    type: "oauth",
    methodID,
    access: "secret-token",
    refresh: "secret-token",
    expires: 0,
  })
  const directory = AbsolutePath.make("/fixture")
  const ctx: SessionContext = {
    location: new Location.Info({
      directory,
      project: { id: Project.ID.make("fixture"), directory, canonical: directory },
    }),
    integration: {
      connection: {
        active: () => Effect.succeed({ type: "credential", id: Credential.ID.create(), label: "Kilo" }),
        resolve: () => Effect.succeed(credential),
      },
    },
    rpc: {
      register: (definition, handlers) =>
        Effect.sync(() => {
          if (definition.id === KiloSession.Definition.id) {
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            rpc.handlers = handlers as unknown as RpcHandlers<typeof KiloSession.Definition>
          }
          return { dispose: Effect.void, events: { emit: () => Effect.void } }
        }),
    },
    storage: {
      get: (key) => Effect.sync(() => storage.get(key)),
      set: (key, value) => Effect.sync(() => storage.set(key, value)).pipe(Effect.asVoid),
    },
  }
  return {
    ctx,
    storage,
    register: (options: { sessions: string; shareApp?: string }) =>
      Effect.runPromise(
        Effect.scoped(registerSessions(ctx, { ...options, server: "https://api.kilo.ai" }, methodID, services)),
      ),
    rpc: () => {
      if (!rpc.handlers) throw new Error("Kilo session RPC was not registered")
      return rpc.handlers
    },
  }
}

function call<M extends (typeof KiloSession.Definition.methods)[keyof typeof KiloSession.Definition.methods]>() {
  // The production host brands the same type/message object after validating it against the definition.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return { error: (type: string, message: string) => ({ type, message }) } as unknown as RpcCallContext<M>
}

test("share bootstraps, uploads a v2 snapshot, and returns the Kilo public URL", async () => {
  const requests: Array<{ url: URL; method: string; authorization: string | null; body: unknown }> = []
  using backend = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      requests.push({
        url,
        method: request.method,
        authorization: request.headers.get("authorization"),
        body: request.method === "POST" ? await request.json() : undefined,
      })
      if (url.pathname === "/api/session") return Response.json({ id: "cloud", ingestPath: "/ingest/ses_source" })
      if (url.pathname === "/ingest/ses_source") return new Response(null, { status: 204 })
      if (url.pathname === "/api/session/ses_source/share")
        return Response.json({ success: true, share_token: shareToken })
      return new Response(null, { status: 404 })
    },
  })
  const host = harness()
  host.storage.set("session:ses_source", {
    id: "stale",
    server: "https://old.example",
    ingestPath: "/stale",
  })
  await host.register({ sessions: backend.url.href, shareApp: "https://app.kilo.ai" })
  const result = await Effect.runPromise(
    host.rpc().share({ sessionID: Session.ID.make("ses_source"), data: transfer() }, call()),
  )

  expect(result).toEqual({ url: shareURL })
  expect(requests.map((item) => [item.method, item.url.pathname, item.url.search])).toEqual([
    ["POST", "/api/session", ""],
    ["POST", "/ingest/ses_source", "?v=2"],
    ["POST", "/api/session/ses_source/share", ""],
  ])
  expect(requests.every((item) => item.authorization === "Bearer secret-token")).toBe(true)
  expect(requests[1]?.body).toEqual({
    data: [
      { type: "session", data: encodeTransfer(transfer()).info },
      { type: "message", data: encodeTransfer(transfer()).messages[0] },
      { type: "message", data: encodeTransfer(transfer()).messages[1] },
    ],
  })
  expect(host.storage.get("session:ses_source")).toEqual({
    id: "cloud",
    server: backend.url.href.replace(/\/$/, ""),
    ingestPath: "/ingest/ses_source",
    url: shareURL,
  })
})

test("unshare retains ingest metadata while removing the public URL", async () => {
  using backend = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 204 }),
  })
  const host = harness()
  host.storage.set("session:ses_source", {
    id: "cloud",
    server: backend.url.href.replace(/\/$/, ""),
    ingestPath: "/ingest/ses_source",
    url: shareURL,
  })
  await host.register({ sessions: backend.url.href })
  await Effect.runPromise(host.rpc().unshare({ sessionID: Session.ID.make("ses_source") }, call()))
  expect(host.storage.get("session:ses_source")).toEqual({
    id: "cloud",
    server: backend.url.href.replace(/\/$/, ""),
    ingestPath: "/ingest/ses_source",
  })
})

test("fork imports a public v2 share as a new independent root session", async () => {
  const imported: Parameters<SessionServices["import"]>[0][] = []
  const services: SessionServices = {
    import: (input) =>
      Effect.sync(() => {
        imported.push(input)
        return input.data.info
      }),
  }
  using backend = Bun.serve({
    port: 0,
    fetch: () => {
      const encoded = encodeTransfer(transfer())
      return Response.json({ info: encoded.info, messages: encoded.messages.map((info) => ({ info, parts: [] })) })
    },
  })
  const host = harness(services)
  await host.register({ sessions: backend.url.href })
  const location = Location.Ref.make({ directory: AbsolutePath.make("/destination") })
  const result = await Effect.runPromise(host.rpc().fork({ share: shareURL, location }, call()))

  expect(result.id).not.toBe("ses_source")
  expect(result.parentID).toBeUndefined()
  expect(result.fork).toBeUndefined()
  expect(result.revert).toBeUndefined()
  expect(result.location).toEqual(location)
  expect(imported[0]?.data.messages[0]?.id).not.toBe("msg_source")
  expect(imported[0]?.data.messages[0]).toMatchObject({ type: "user", text: "hello" })
  expect(imported[0]?.data.messages[1]).toMatchObject({
    type: "assistant",
    content: [{ type: "text", text: "hello back" }],
  })
  expect(imported[0]?.data.messages[1]?.id).not.toBe("msg_assistant")
  expect(imported[0]?.data.messages[1]).not.toHaveProperty("snapshot", expect.anything())
})

test.each(["KILO_DISABLE_SHARE", "KILO_DISABLE_SESSION_INGEST"])(
  "%s blocks uploads but still allows revoking a public link",
  async (flag) => {
    const requests: string[] = []
    using backend = Bun.serve({
      port: 0,
      fetch: (request) => {
        requests.push(new URL(request.url).pathname)
        return new Response(null, { status: 204 })
      },
    })
    const host = harness()
    await host.register({ sessions: backend.url.href })
    const previous = process.env[flag]
    process.env[flag] = "true"
    try {
      const result = await Effect.runPromise(
        host
          .rpc()
          .share({ sessionID: Session.ID.make("ses_source"), data: transfer() }, call())
          .pipe(
            Effect.match({
              onFailure: (error) => error.message,
              onSuccess: () => undefined,
            }),
          ),
      )
      expect(result).toBe("Session sharing is disabled")
      expect(requests).toEqual([])
      await Effect.runPromise(host.rpc().unshare({ sessionID: Session.ID.make("ses_source") }, call()))
      expect(requests).toEqual(["/api/session/ses_source/unshare"])
    } finally {
      if (previous !== undefined) process.env[flag] = previous
      if (previous === undefined) delete process.env[flag]
    }
  },
)

test("share rejects a transcript for a different session before contacting Kilo", async () => {
  let requests = 0
  using backend = Bun.serve({
    port: 0,
    fetch: () => {
      requests++
      return new Response(null, { status: 500 })
    },
  })
  const host = harness()
  await host.register({ sessions: backend.url.href })
  const result = await Effect.runPromise(
    host
      .rpc()
      .share({ sessionID: Session.ID.make("ses_other"), data: transfer() }, call())
      .pipe(
        Effect.match({
          onFailure: (error) => ({ type: error.type, message: error.message }),
          onSuccess: () => undefined,
        }),
      ),
  )
  expect(result).toEqual({ type: "kilocode.session", message: "The session export does not match the session ID" })
  expect(requests).toBe(0)
})

test.each([
  { name: "legacy transcript", data: { legacy: true } },
  { name: "flat local export", data: encodeTransfer(transfer()) },
  {
    name: "separate message parts",
    data: {
      info: encodeTransfer(transfer()).info,
      messages: [{ info: encodeTransfer(transfer()).messages[0], parts: [{ type: "text", text: "must not be lost" }] }],
    },
  },
])("fork rejects $name without importing it", async ({ data }) => {
  let imports = 0
  using backend = Bun.serve({
    port: 0,
    fetch: () => Response.json(data),
  })
  const host = harness({
    import: () =>
      Effect.sync(() => {
        imports++
        return transfer().info
      }),
  })
  await host.register({ sessions: backend.url.href })
  const result = await Effect.runPromise(
    host
      .rpc()
      .fork({ share: shareToken, location: undefined }, call())
      .pipe(
        Effect.match({
          onFailure: (error) => ({ type: error.type, message: error.message }),
          onSuccess: () => undefined,
        }),
      ),
  )
  expect(result).toEqual({
    type: "kilocode.session",
    message: "The shared session is not compatible with Kilo v2",
  })
  expect(imports).toBe(0)
})

test("fork rejects a share URL from another origin before fetching", async () => {
  let requests = 0
  using backend = Bun.serve({
    port: 0,
    fetch: () => {
      requests++
      return Response.json(encodeTransfer(transfer()))
    },
  })
  const host = harness({ import: (input) => Effect.succeed(input.data.info) })
  await host.register({ sessions: backend.url.href })
  const result = await Effect.runPromise(
    host
      .rpc()
      .fork({ share: `https://example.test/s/${shareToken}`, location: undefined }, call())
      .pipe(
        Effect.match({
          onFailure: (error) => ({ type: error.type, message: error.message }),
          onSuccess: () => undefined,
        }),
      ),
  )
  expect(result).toEqual({ type: "kilocode.session", message: "Invalid Kilo share URL or token" })
  expect(requests).toBe(0)
})
