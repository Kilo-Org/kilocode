import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OpenCode, type OpenCodeEvent } from "@opencode-ai/client"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { ToolEditor } from "@opencode-ai/plugin/effect/tool"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import type { Tool } from "@opencode-ai/schema/tool"
import { Effect } from "effect"
import { launch } from "../src/interactive-server"
import type { Layout } from "../src/paths"
import {
  createIndexingPlugin,
  indexingRoot,
  startIndexing,
  type IndexingHost,
  type IndexingLocation,
} from "../src/indexing"
import type { ToolAuthorizationInput } from "../src/tool-authorization"
import { IndexingRpc } from "../src/indexing-rpc"
import { fixture } from "./fixture"

const DIMENSION = 256

/**
 * Local embedding service. It speaks the OpenAI `/embeddings` shape over
 * loopback and returns a deterministic hashed bag-of-words vector, so indexing
 * and search exercise the real engine, the real embedder transport, and a real
 * LanceDB table without any paid inference.
 */
function embeddingServer(requests: string[] = []) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      if (!request.url.endsWith("/embeddings")) return new Response("not found", { status: 404 })
      const body = (await request.json()) as { input: string[] | string; model?: string }
      const texts = Array.isArray(body.input) ? body.input : [body.input]
      requests.push(...texts)
      return Response.json({
        data: texts.map((text, index) => ({ embedding: embed(text), index })),
        usage: { prompt_tokens: texts.length, total_tokens: texts.length },
      })
    },
  })
  return { server, requests }
}

function embed(text: string) {
  const vector = new Array<number>(DIMENSION).fill(0)
  for (const token of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    // FNV-1a keeps distinct identifiers in distinct buckets at this dimension.
    let hash = 0x811c9dc5
    for (const character of token) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0
    vector[hash % DIMENSION] += 1
  }
  const length = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
  return length === 0 ? vector.map((_, index) => (index === 0 ? 1 : 0)) : vector.map((value) => value / length)
}

const files = {
  "src/auth.ts": `export function authenticateUser(username: string, password: string) {
  const hashed = hashPassword(password)
  const credential = loadCredential(username)
  if (!credential) return false
  return credential.password === hashed
}

export function hashPassword(password: string) {
  return "hashed:" + password.split("").reverse().join("")
}

export function loadCredential(username: string) {
  return { username, password: hashPassword(username) }
}
`,
  "src/cart.ts": `export function cartTotal(items: { price: number; quantity: number }[]) {
  return items.reduce((total, item) => total + item.price * item.quantity, 0)
}

export function applyDiscount(total: number, percentage: number) {
  const discount = (total * percentage) / 100
  return Math.max(0, total - discount)
}
`,
  "metrics/telemetry.ts": `export function recordCounter(name: string, delta: number) {
  const counters = new Map<string, number>()
  counters.set(name, (counters.get(name) ?? 0) + delta)
  return counters
}

export function flushTelemetry(counters: Map<string, number>) {
  return [...counters.entries()].map(([name, value]) => name + "=" + value)
}
`,
  // `vendor` is in the engine's default ignored-folder set, so this file must never be indexed.
  "vendor/ignored.ts": `export function vendoredHelper(input: string) {
  return input.split("").map((character) => character.toUpperCase()).join("-")
}
`,
}

async function withWorkspace(run: (input: { workspace: string; state: string }) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-indexing-"))
  try {
    const workspace = path.join(root, "checkout")
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.join(workspace, path.dirname(name)), { recursive: true })
      await writeFile(path.join(workspace, name), content)
    }
    await run({ workspace, state: path.join(root, "state") })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function location(directory: string): IndexingLocation {
  return {
    directory: AbsolutePath.make(directory),
    project: {
      id: ProjectID.make("project-indexing-test"),
      directory: AbsolutePath.make(directory),
      canonical: AbsolutePath.make(directory),
    },
  }
}

function settings(baseUrl: string) {
  return {
    enabled: true,
    provider: "openai-compatible" as const,
    model: "local-test-embed",
    dimension: DIMENSION,
    vectorStore: "lancedb" as const,
    // A full endpoint URL keeps the embedder on its direct-fetch transport.
    "openai-compatible": { baseUrl: `${baseUrl}/v1/embeddings`, apiKey: "local-test-key" },
    searchMinScore: 0,
    fileExtensions: [".ts"],
  }
}

async function indexed(host: IndexingHost) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const status = host.status()
    if (status.state === "Complete") return status
    if (status.state === "Error") throw new Error(`Indexing failed: ${status.message}`)
    await Bun.sleep(50)
  }
  throw new Error(`Indexing did not complete: ${JSON.stringify(host.status())}`)
}

/** Captures tool definitions registered through the public v2 transform. */
function toolCapture(directory: string) {
  const added: (Tool.Info & { readonly name: string })[] = []
  const transform: Context["tool"]["transform"] = (callback) => {
    const editor: ToolEditor = {
      list: () => [],
      get: () => undefined,
      namespace: () => undefined,
      add: (definition) => added.push(definition as Tool.Info & { readonly name: string }),
      update: () => undefined,
      remove: () => undefined,
    }
    callback(editor)
    return Effect.succeed({ dispose: Effect.succeed(undefined) })
  }
  return {
    added,
    context: {
      location: location(directory),
      tool: { transform },
      rpc: { register: () => Effect.succeed({ dispose: Effect.void }) },
    } as unknown as Context,
  }
}

test("derives the index root from the isolated state directory", () => {
  expect(indexingRoot(path.join(os.tmpdir(), "kilo2-state"))).toBe(path.join(os.tmpdir(), "kilo2-state", "indexing"))
})

test("indexes a real workspace into LanceDB and answers semantic search", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const { server } = embeddingServer()
    const host = await startIndexing({ state, settings: settings(server.url.origin) }, location(workspace))
    try {
      expect(host.available).toBe(true)
      const status = await indexed(host)
      // src/auth.ts, src/cart.ts, metrics/telemetry.ts — vendor/ignored.ts is excluded by the engine's ignore rules.
      expect(status.totalFiles).toBe(3)
      expect(status.processedFiles).toBe(3)

      const result = await host.search({ query: "authenticate a user password credential" })
      expect(result.results.length).toBeGreaterThan(0)
      expect(result.results[0]!.filePath).toBe("src/auth.ts")
      expect(result.results[0]!.score).toBeGreaterThan(0)
      expect(result.results[0]!.codeChunk).toContain("authenticateUser")
      expect(result.output).toContain("src/auth.ts:")
      expect(result.title).toBe("Codebase Search")

      // Shares vocabulary with both src/auth.ts and the ignored vendor file.
      const everything = await host.search({ query: "input split character join" })
      expect(everything.results.length).toBeGreaterThan(0)
      expect(everything.results.some((item) => item.filePath.startsWith("vendor/"))).toBe(false)

      // A real LanceDB prefix filter, not a post-filter over every match.
      const scoped = await host.search({ query: "counters name delta map", path: "metrics" })
      expect(scoped.results.length).toBeGreaterThan(0)
      expect(scoped.results.every((item) => item.filePath.startsWith("metrics/"))).toBe(true)
      expect(scoped.output).toContain("in metrics")

      const empty = await host.search({ query: "authenticate a user password", path: "src/missing" })
      expect(empty.results).toEqual([])
      expect(empty.output).toBe('No relevant code found for "authenticate a user password" in src/missing.')

      await expect(host.search({ query: "runner", path: "../elsewhere" })).rejects.toThrow(
        "path must be within the current workspace: ../elsewhere",
      )
      await expect(host.search({ query: "" })).rejects.toThrow("query is required")
    } finally {
      await host.dispose()
      await server.stop(true)
    }
  })
}, 60_000)

test("registers semantic_search through the plugin and returns real matches", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const { server } = embeddingServer()
    const capture = toolCapture(workspace)
    const authorizations: ToolAuthorizationInput[] = []
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* createIndexingPlugin({
              state,
              settings: settings(server.url.origin),
              authorize: (input) => {
                authorizations.push(input)
                return Effect.succeed(undefined)
              },
            }).effect(capture.context)
            expect(capture.added.map((tool) => tool.name)).toEqual(["semantic_search"])
            expect(capture.added[0]!.options).toEqual({ codemode: false, permission: "semantic_search" })

            // Calls before the first index exists fail with the engine's own error; the
            // tool becomes useful as soon as the table is written.
            const deadline = Date.now() + 20_000
            while (Date.now() < deadline) {
              const outcome = yield* Effect.exit(
                capture.added[0]!.execute({ query: "hash a password" }, {
                  sessionID: "ses_indexing_test",
                  agent: "build",
                  messageID: "msg_indexing_test",
                  id: "call_indexing_test",
                } as unknown as Tool.Context),
              )
              const result = outcome._tag === "Success" ? outcome.value : undefined
              const results = result?.metadata?.["results"] as readonly { readonly filePath: string }[] | undefined
              if (results?.length) {
                expect(authorizations[0]).toMatchObject({
                  action: "semantic_search",
                  sessionID: "ses_indexing_test",
                  agent: "build",
                  messageID: "msg_indexing_test",
                  callID: "call_indexing_test",
                  resources: ["hash a password"],
                  save: ["*"],
                })
                expect(results[0]!.filePath).toBe("src/auth.ts")
                expect(result!.content).toContain("src/auth.ts:")
                return
              }
              yield* Effect.promise(() => Bun.sleep(100))
            }
            throw new Error("semantic_search never returned an indexed match")
          }),
        ),
      )
    } finally {
      await server.stop(true)
    }
  })
}, 60_000)

test("fails closed when semantic_search has no host authorizer", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const { server } = embeddingServer()
    const capture = toolCapture(workspace)
    try {
      await Effect.runPromise(
        Effect.scoped(createIndexingPlugin({ state, settings: settings(server.url.origin) }).effect(capture.context)),
      )
      expect(capture.added).toHaveLength(1)
      await expect(
        Effect.runPromise(
          capture.added[0]!.execute({ query: "must not search" }, {
            sessionID: "ses_indexing_no_authorizer",
            agent: "build",
            messageID: "msg_indexing_no_authorizer",
            id: "call_indexing_no_authorizer",
          } as unknown as Tool.Context),
        ),
      ).rejects.toThrow("Tool authorization is unavailable")
    } finally {
      await server.stop(true)
    }
  })
}, 60_000)

test("stays disabled and starts no engine when the project has not enabled indexing", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const host = await startIndexing({ state, settings: { enabled: false } }, location(workspace))

    expect(host.available).toBe(false)
    expect(host.status()).toEqual({
      state: "Disabled",
      message: "Codebase indexing is disabled for this project.",
      processedFiles: 0,
      totalFiles: 0,
      percent: 0,
    })
    await expect(host.search({ query: "anything" })).rejects.toThrow("Codebase indexing is disabled for this project.")
    expect(await Bun.file(path.join(indexingRoot(state), "lancedb")).exists()).toBe(false)
    await host.dispose()
  })
})

test("registers no tool when the workspace is enabled but not configured", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const capture = toolCapture(workspace)
    await Effect.runPromise(
      Effect.scoped(
        createIndexingPlugin({ state, settings: { enabled: true, provider: "openai-compatible" } }).effect(
          capture.context,
        ),
      ),
    )

    expect(capture.added).toEqual([])
  })
})

test("reports an unreachable embedding service as a v1-shaped error status", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const { server } = embeddingServer()
    const port = server.port
    await server.stop(true)
    const host = await startIndexing({ state, settings: settings(`http://127.0.0.1:${port}`) }, location(workspace))
    try {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline && host.status().state !== "Error") await Bun.sleep(50)
      expect(host.status().state).toBe("Error")
      expect(host.status().message.length).toBeGreaterThan(0)
    } finally {
      await host.dispose()
    }
  })
}, 60_000)

test("refuses a configured store directory outside the isolated index root", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const { server, requests } = embeddingServer()
    const outside = path.join(path.dirname(state), "elsewhere")
    try {
      const host = await startIndexing(
        { state, settings: { ...settings(server.url.origin), lancedb: { directory: outside } } },
        location(workspace),
      )

      expect(host.available).toBe(false)
      expect(host.status().state).toBe("Error")
      expect(host.status().message).toBe("indexing.lancedb.directory must stay inside the isolated index root")
      // Refused, not silently rewritten: nothing was written and nothing was embedded.
      expect(await Bun.file(outside).exists()).toBe(false)
      expect(requests).toEqual([])
      await host.dispose()
    } finally {
      await server.stop(true)
    }
  })
})

test("accepts a configured store directory inside the isolated index root", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const { server } = embeddingServer()
    const inside = path.join(indexingRoot(state), "store")
    const host = await startIndexing(
      { state, settings: { ...settings(server.url.origin), lancedb: { directory: inside } } },
      location(workspace),
    )
    try {
      expect(host.available).toBe(true)
      await indexed(host)
      expect((await readdir(inside)).length).toBeGreaterThan(0)
    } finally {
      await host.dispose()
      await server.stop(true)
    }
  })
})

test("disabled indexing transmits no source code and creates no index", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const { server, requests } = embeddingServer()
    try {
      const host = await startIndexing(
        { state, settings: { ...settings(server.url.origin), enabled: false } },
        location(workspace),
      )
      expect(host.available).toBe(false)
      expect(host.status().state).toBe("Disabled")
      expect(requests).toEqual([])
      expect(await Bun.file(indexingRoot(state)).exists()).toBe(false)
      await host.dispose()
    } finally {
      await server.stop(true)
    }
  })
})

test("enabled but unconfigured indexing transmits no source code and registers no tool", async () => {
  await withWorkspace(async ({ workspace, state }) => {
    const { server, requests } = embeddingServer()
    const capture = toolCapture(workspace)
    try {
      await Effect.runPromise(
        Effect.scoped(
          createIndexingPlugin({ state, settings: { enabled: true, provider: "openai-compatible" } }).effect(
            capture.context,
          ),
        ),
      )
      expect(capture.added).toEqual([])
      expect(requests).toEqual([])
    } finally {
      await server.stop(true)
    }
  })
})

test("host wiring: the model calls semantic_search and the public history carries indexed matches", async () => {
  await using input = await fixture()
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.join(input.cwd, path.dirname(name)), { recursive: true })
    await writeFile(path.join(input.cwd, name), content)
  }
  const { server: embeddings, requests: embedded } = embeddingServer()
  const model = searchingModel()
  const prompts = model.prompts
  const layout = makeInteractiveLayout(path.join(input.directory, "indexing-interactive"), input.home)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: modelConfig(model.server.url.origin),
            indexing: settings(embeddings.url.origin),
          })
          const client = OpenCode.make({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const scope = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(scope))
          // The engine indexes the activated location, under the isolated state root.
          const table = yield* Effect.promise(() => stored(layout))
          expect(table).toStartWith(`${path.basename(input.cwd)}-`)
          // The engine embedded the fixture source before any model turn runs.
          yield* Effect.promise(() => embeddedAuth(embedded))
          const status = yield* Effect.promise(() => client.rpc(IndexingRpc).status({}, scope))
          expect(["In Progress", "Complete"]).toContain(status.state)
          expect(status.message).not.toContain("local-test-key")

          const session = yield* Effect.promise(() =>
            client.session.create({ title: "Indexing host fixture", ...scope }),
          )
          // Indexing is a background process, so the tool result catches up over a few turns.
          const transcript = yield* Effect.promise(async () => {
            const deadline = Date.now() + 60_000
            let latest = ""
            while (Date.now() < deadline) {
              await client.session.prompt({ sessionID: session.id, text: "Find where passwords are hashed" })
              await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30_000) })
              latest = JSON.stringify(await client.message.list({ sessionID: session.id }))
              if (latest.includes("src/auth.ts")) return latest
              await Bun.sleep(250)
            }
            throw new Error(`semantic_search never returned an indexed match: ${latest}`)
          })
          expect(transcript).toContain("semantic_search")
          expect(transcript).toContain("Codebase Search")
          expect(transcript).toContain("src/auth.ts")
          // Ignored directories never reach the model through the tool result.
          expect(transcript).not.toContain("vendor/ignored.ts")
          expect(prompts.length).toBeGreaterThan(1)
        }),
      ),
    )
  } finally {
    await model.server.stop(true)
    await embeddings.stop(true)
  }
}, 120_000)

test("authorizes semantic search before querying and preserves ask, allow, and deny", async () => {
  await using input = await fixture()
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.join(input.cwd, path.dirname(name)), { recursive: true })
    await writeFile(path.join(input.cwd, name), content)
  }
  const { server: embeddings, requests: embedded } = embeddingServer()
  const model = searchingModel()
  const layout = makeInteractiveLayout(path.join(input.directory, "indexing-permission-interactive"), input.home)
  const permissions = [
    { action: "semantic_search", resource: "hashed password credential", effect: "ask" as const },
    { action: "semantic_search", resource: "allowed-query-unique", effect: "allow" as const },
    { action: "semantic_search", resource: "denied-query-unique", effect: "deny" as const },
  ]
  try {
    const rejected = await runIndexingAuthorizationCase({
      fixture: input,
      layout,
      modelOrigin: model.server.url.origin,
      embeddingOrigin: embeddings.url.origin,
      embedded,
      permissions,
      prompt: "reject semantic search",
      reply: "reject",
    })
    expect(rejected.asked).toMatchObject({
      action: "semantic_search",
      resources: ["hashed password credential"],
      save: ["*"],
      metadata: { query: "hashed password credential" },
    })
    expect(embedded).not.toContain("hashed password credential")
    expect(rejected.transcript).not.toContain("Codebase Search")

    const allowed = await runIndexingAuthorizationCase({
      fixture: input,
      layout,
      modelOrigin: model.server.url.origin,
      embeddingOrigin: embeddings.url.origin,
      embedded,
      permissions,
      prompt: "allow semantic search",
    })
    expect(allowed.asked).toBeUndefined()
    expect(embedded).toContain("allowed-query-unique")
    expect(allowed.transcript).toContain("semantic_search")

    const denied = await runIndexingAuthorizationCase({
      fixture: input,
      layout,
      modelOrigin: model.server.url.origin,
      embeddingOrigin: embeddings.url.origin,
      embedded,
      permissions,
      prompt: "deny semantic search",
    })
    expect(denied.asked).toBeUndefined()
    expect(embedded).not.toContain("denied-query-unique")
    expect(denied.transcript).not.toContain("Codebase Search")
  } finally {
    await model.server.stop(true)
    await embeddings.stop(true)
  }
}, 120_000)

/** A model that always asks for `semantic_search`, then answers once the result returns. */
function searchingModel() {
  const prompts: string[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = (await request.json()) as { messages: { role: string; content?: unknown }[] }
      prompts.push(body.messages.at(-1)?.role ?? "unknown")
      if (body.messages.at(-1)?.role === "tool")
        return streamModel({ role: "assistant", content: "Reviewed the semantic search results." }, "stop")
      const prompt = String([...body.messages].reverse().find((message) => message.role === "user")?.content ?? "")
      const query = prompt.includes("deny")
        ? "denied-query-unique"
        : prompt.includes("allow")
          ? "allowed-query-unique"
          : "hashed password credential"
      return streamModel(
        {
          tool_calls: [
            {
              index: 0,
              id: "call_semantic",
              type: "function",
              function: { name: "semantic_search", arguments: JSON.stringify({ query }) },
            },
          ],
        },
        "tool_calls",
      )
    },
  })
  return { server, prompts }
}

function modelConfig(origin: string, permissions?: readonly IndexingPermissionRule[]) {
  return JSON.stringify({
    model: "fixture/chat",
    ...(permissions === undefined ? {} : { permissions }),
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `${origin}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
}

function streamModel(delta: Record<string, unknown>, finishReason: string) {
  const frames = [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
  ]
  return new Response(
    frames
      .map(
        (frame) =>
          `data: ${JSON.stringify({ id: "indexing-fixture", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

/** Waits until the engine has sent the fixture's own source to the embedding service. */
async function embeddedAuth(embedded: readonly string[]) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (embedded.some((text) => text.includes("hashPassword"))) return
    await Bun.sleep(50)
  }
  throw new Error("the engine never embedded the fixture source")
}

/** Waits for a real LanceDB table under the isolated root and returns its directory name. */
async function stored(layout: Layout) {
  const store = path.join(indexingRoot(layout.paths.state), "lancedb")
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const tables = await readdir(store, { recursive: true }).catch(() => [] as string[])
    const table = tables.find((entry) => entry.endsWith("vector.lance"))
    if (table) return table.split(path.sep)[0]!
    await Bun.sleep(100)
  }
  throw new Error("the engine never wrote a LanceDB table")
}

function makeInteractiveLayout(root: string, home: string): Layout {
  const paths = {
    home,
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

type IndexingPermissionRule = {
  readonly action: string
  readonly resource: string
  readonly effect: "ask" | "allow" | "deny"
}
type IndexingPermissionAskedEvent = Extract<OpenCodeEvent, { type: "permission.asked" }>

async function runIndexingAuthorizationCase(input: {
  readonly fixture: Awaited<ReturnType<typeof fixture>>
  readonly layout: Layout
  readonly modelOrigin: string
  readonly embeddingOrigin: string
  readonly embedded: readonly string[]
  readonly permissions: readonly IndexingPermissionRule[]
  readonly prompt: string
  readonly reply?: "reject" | "once"
}) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(input.layout, {
          models: false,
          recover: false,
          content: modelConfig(input.modelOrigin, input.permissions),
          indexing: settings(input.embeddingOrigin),
        })
        const client = OpenCode.make({
          baseUrl: server.url,
          headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
        })
        const scope = { location: { directory: input.fixture.cwd } }
        yield* Effect.promise(() => client.plugin.awaitActivation(scope))
        yield* Effect.promise(() => embeddedAuth(input.embedded))
        const session = yield* Effect.promise(() =>
          client.session.create({
            title: "Indexing permission fixture",
            ...scope,
            model: { providerID: "fixture", id: "chat" },
          }),
        )
        const events: OpenCodeEvent[] = []
        const controller = new AbortController()
        const pump = (async () => {
          try {
            for await (const event of client.event.subscribe({ signal: controller.signal })) events.push(event)
          } catch {}
        })()
        try {
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: input.prompt }))
          const asked = yield* Effect.promise(() =>
            input.reply ? waitForIndexingPermission(events, session.id) : Promise.resolve(undefined),
          )
          if (asked && input.reply) {
            yield* Effect.promise(() =>
              client.permission.reply({ sessionID: session.id, requestID: asked.id, reply: input.reply! }),
            )
          }
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(20_000) }),
          )
          const transcript = JSON.stringify(yield* Effect.promise(() => client.message.list({ sessionID: session.id })))
          return { asked, transcript }
        } finally {
          controller.abort()
          yield* Effect.promise(() => pump.catch(() => undefined))
        }
      }),
    ),
  )
}

function isIndexingPermissionAsked(event: OpenCodeEvent, sessionID: string): event is IndexingPermissionAskedEvent {
  return event.type === "permission.asked" && event.data.sessionID === sessionID
}

async function waitForIndexingPermission(events: readonly OpenCodeEvent[], sessionID: string) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const event = events.find((item): item is IndexingPermissionAskedEvent =>
      isIndexingPermissionAsked(item, sessionID),
    )
    if (event) return event.data
    await Bun.sleep(20)
  }
  throw new Error("semantic search permission request did not arrive")
}

test("host wiring: a disabled configuration exposes no tool, starts no engine, and sends no code", async () => {
  await using input = await fixture()
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.join(input.cwd, path.dirname(name)), { recursive: true })
    await writeFile(path.join(input.cwd, name), content)
  }
  const { server: embeddings, requests: embedded } = embeddingServer()
  const model = searchingModel()
  const layout = makeInteractiveLayout(path.join(input.directory, "disabled-interactive"), input.home)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: modelConfig(model.server.url.origin),
            indexing: { ...settings(embeddings.url.origin), enabled: false },
          })
          const client = OpenCode.make({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const scope = { location: { directory: input.cwd } }
          yield* Effect.promise(() => client.plugin.awaitActivation(scope))
          const session = yield* Effect.promise(() =>
            client.session.create({ title: "Disabled indexing fixture", ...scope }),
          )
          yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "Find where passwords are hashed" }),
          )
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30_000) }),
          )

          // The model asked for the tool; without an engine there is nothing to call,
          // so no chunk of the workspace ever reaches the provider or the transcript.
          const transcript = JSON.stringify(yield* Effect.promise(() => client.message.list({ sessionID: session.id })))
          expect(transcript).not.toContain("Codebase Search")
          expect(transcript).not.toContain("src/auth.ts")
          expect(embedded).toEqual([])
          const created = yield* Effect.promise(() => Bun.file(indexingRoot(layout.paths.state)).exists())
          expect(created).toBe(false)
        }),
      ),
    )
  } finally {
    await model.server.stop(true)
    await embeddings.stop(true)
  }
}, 60_000)
