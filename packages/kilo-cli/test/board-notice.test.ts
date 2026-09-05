import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { define, type Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import path from "node:path"
import { launch } from "../src/interactive-server"
import type { Layout } from "../src/paths"
import { fixture, type Fixture } from "./fixture"

type Client = ReturnType<typeof createClient>
type Completion = {
  stream?: boolean
  messages: { role: string; content?: unknown }[]
}
function answer(tool?: { name: string; arguments: string }) {
  const delta = tool
    ? { tool_calls: [{ index: 0, id: "call_board_notice", type: "function", function: tool }] }
    : { role: "assistant", content: "fixture complete" }
  return new Response(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] },
    ]
      .map(
        (frame) =>
          `data: ${JSON.stringify({ id: "board-notice-fixture", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

function modelServer() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: Completion = await request.json()
      if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "fixture" } }] })
      if (body.messages.at(-1)?.role === "tool") return answer()
      const text = String(body.messages.findLast((message) => message.role === "user")?.content)
      if (text === "post")
        return answer({
          name: "board_post",
          arguments: JSON.stringify({ to: "ALL", type: "INFO", body: "fixture board activity" }),
        })
      if (text === "read") return answer({ name: "board_read", arguments: JSON.stringify({ limit: 50 }) })
      return answer()
    },
  })
}

function config(baseURL: string, agents: Record<string, { permissions: Permission[] }>) {
  return JSON.stringify({
    model: "fixture/chat",
    default_agent: "native-allow",
    agents: Object.fromEntries(
      Object.entries(agents).map(([id, value]) => [id, { mode: "primary", permissions: value.permissions }]),
    ),
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `${baseURL}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
}

type Permission = { action: string; resource: string; effect: "allow" | "ask" | "deny" }

const broadAllow: Permission = { action: "*", resource: "*", effect: "allow" }
const boardPostAllow: Permission = { action: "board_post", resource: "*", effect: "allow" }
const boardReadAllow: Permission = { action: "board_read", resource: "*", effect: "allow" }
const boardReadAsk: Permission = { action: "board_read", resource: "*", effect: "ask" }
const boardReadDeny: Permission = { action: "board_read", resource: "*", effect: "deny" }

async function withHost<T>(
  input: Fixture,
  content: string,
  run: (client: Client) => Promise<T>,
  plugins: readonly Plugin[] = [],
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(makeInteractiveLayout(input.directory, input.home), {
          models: false,
          recover: false,
          content,
          swarm: true,
          plugins,
        })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: { authorization: `Basic ${btoa(`opencode:${endpoint.auth.password}`)}` },
        })
        yield* Effect.promise(() => client.plugin.awaitActivation({ location: { directory: input.cwd } }))
        return yield* Effect.promise(() => run(client))
      }),
    ),
  )
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

async function idle(client: Client, sessionID: string) {
  await client.session.wait({ sessionID }, { signal: AbortSignal.timeout(10_000) })
}

async function prompt(client: Client, sessionID: string, text: string) {
  await client.session.prompt({ sessionID, text })
  await idle(client, sessionID)
}

async function promptWithPermission(client: Client, sessionID: string, text: string, reply: "always" | "once") {
  await client.session.prompt({ sessionID, text })
  const request = await waitFor(async () => (await client.permission.list({ sessionID })).at(0))
  await client.permission.reply({ sessionID, requestID: request.id, reply })
  await idle(client, sessionID)
}

async function latestToolMetadata(client: Client, sessionID: string, name: string) {
  const messages = await client.message.list({ sessionID, order: "asc" })
  const part = messages.data
    .flatMap((message) =>
      message.type === "assistant" ? message.content.filter((part) => part.type === "tool" && part.name === name) : [],
    )
    .at(-1)
  if (!part || part.type !== "tool" || part.state.status !== "completed")
    throw new Error(`Expected completed ${name}: ${JSON.stringify(part)}`)
  return part.state.metadata
}

async function waitFor<T>(read: () => Promise<T | undefined>, milliseconds = 8_000) {
  const started = Date.now()
  while (Date.now() - started < milliseconds) {
    const value = await read()
    if (value !== undefined) return value
    await Bun.sleep(10)
  }
  throw new Error("Timed out waiting for native permission")
}

test("board notice guard allows native allow and keeps ask non-interactive", async () => {
  await using input = await fixture()
  const model = modelServer()
  try {
    const agents = {
      "native-allow": { permissions: [broadAllow, boardPostAllow, boardReadAllow] },
      ask: { permissions: [broadAllow, boardPostAllow, boardReadAsk] },
    }
    await withHost(input, config(model.url.origin, agents), async (client) => {
      const allowed = await client.session.create({ location: { directory: input.cwd }, agent: "native-allow" })
      await prompt(client, allowed.id, "post")
      expect((await latestToolMetadata(client, allowed.id, "board_post"))?.shared_agent_board_notice).toBe("activity")

      const asking = await client.session.create({ location: { directory: input.cwd }, agent: "ask" })
      await prompt(client, asking.id, "post")
      expect((await latestToolMetadata(client, asking.id, "board_post"))?.shared_agent_board_notice).toBeUndefined()
      expect(await client.permission.list({ sessionID: asking.id })).toEqual([])
    })
  } finally {
    model.stop(true)
  }
})

test("board notice guard lets a saved allow through but configured deny wins", async () => {
  await using input = await fixture()
  const model = modelServer()
  try {
    const agents = {
      "native-allow": { permissions: [broadAllow, boardPostAllow, boardReadAsk] },
      denied: { permissions: [broadAllow, boardPostAllow, boardReadDeny] },
    }
    await withHost(input, config(model.url.origin, agents), async (client) => {
      const saved = await client.session.create({ location: { directory: input.cwd }, agent: "native-allow" })
      await promptWithPermission(client, saved.id, "read", "always")
      await prompt(client, saved.id, "post")
      expect((await latestToolMetadata(client, saved.id, "board_post"))?.shared_agent_board_notice).toBe("activity")

      const denied = await client.session.create({ location: { directory: input.cwd }, agent: "denied" })
      await prompt(client, denied.id, "post")
      expect((await latestToolMetadata(client, denied.id, "board_post"))?.shared_agent_board_notice).toBeUndefined()
      expect(await client.permission.list({ sessionID: denied.id })).toEqual([])
    })
  } finally {
    model.stop(true)
  }
})

test("board notice guard honors public plugin evaluator deny and allow", async () => {
  await using input = await fixture()
  const model = modelServer()
  try {
    const agents = {
      "native-allow": { permissions: [broadAllow, boardPostAllow, boardReadAllow] },
      "hook-deny": { permissions: [broadAllow, boardPostAllow, boardReadAllow] },
      "hook-allow": { permissions: [broadAllow, boardPostAllow, boardReadAsk] },
    }
    const evaluator = define({
      id: "board-notice-fixture-evaluator",
      effect: (ctx) =>
        ctx.permission.hook("evaluate", (event) =>
          Effect.sync(() => {
            if (event.action !== "board_read") return
            if (event.agent === "hook-deny") event.effect = "deny"
            if (event.agent === "hook-allow") event.effect = "allow"
          }),
        ),
    })
    await withHost(
      input,
      config(model.url.origin, agents),
      async (client) => {
        const denied = await client.session.create({ location: { directory: input.cwd }, agent: "hook-deny" })
        await prompt(client, denied.id, "post")
        expect((await latestToolMetadata(client, denied.id, "board_post"))?.shared_agent_board_notice).toBeUndefined()
        expect(await client.permission.list({ sessionID: denied.id })).toEqual([])

        const allowed = await client.session.create({ location: { directory: input.cwd }, agent: "hook-allow" })
        await prompt(client, allowed.id, "post")
        expect((await latestToolMetadata(client, allowed.id, "board_post"))?.shared_agent_board_notice).toBe("activity")
        expect(await client.permission.list({ sessionID: allowed.id })).toEqual([])
      },
      [evaluator],
    )
  } finally {
    model.stop(true)
  }
})
