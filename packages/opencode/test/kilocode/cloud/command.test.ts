import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { expect } from "bun:test"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import {
  AgentSendRequestSchema,
  AgentStartRequestSchema,
  GetMessageResultInputSchema,
  type AgentSendRequest,
  type AgentStartRequest,
  type MessageResult,
} from "@/kilocode/cloud/contracts"
import { CloudCommands } from "@/kilocode/cloud/commands"
import { CloudError } from "@/kilocode/cloud/errors"
import { Git } from "@/git"
import { Effect, Layer } from "effect"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const SESSION = "agent_12345678-1234-1234-1234-123456789abc"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"
const TOKEN = "command-test-token"
const CONTROL = "command-test-control-token"
const ORG = "11111111-1111-4111-8111-111111111111"

function control() {
  return Response.json({ token: CONTROL, expiresAt: new Date(Date.now() + 600_000).toISOString() })
}

const auth = Layer.mock(Auth.Service)({
  get: (id) =>
    Effect.succeed(
      id === "kilo"
        ? new Auth.Oauth({
            type: "oauth",
            access: TOKEN,
            refresh: "test-refresh",
            expires: Date.now() + 60_000,
            accountId: ORG,
          })
        : undefined,
    ),
})

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(Agent.node),
    AppNodeBuilder.build(Config.node),
    AppNodeBuilder.build(Git.node),
    auth,
  ),
)

const run = Effect.fn("CloudCommandTest.git")(function* (cwd: string, ...args: string[]) {
  const git = yield* Git.Service
  const result = yield* git.run(args, { cwd })
  if (result.exitCode === 0) return
  yield* Effect.die(new Error(result.stderr.toString("utf8")))
})

it.instance(
  "assembles the default start request from Kilo state and the current repository",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === "/api/cloud-agent-next/token") return control()
            if (url.pathname.endsWith("/models")) {
              return Response.json({ data: [{ id: "anthropic/command-model", supported_parameters: ["tools"] }] })
            }
            if (url.pathname.endsWith("/defaults")) {
              return Response.json({ defaultModel: "anthropic/command-model" })
            }
            return new Response(null, { status: 404 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          yield* run(test.directory, "remote", "add", "origin", "git@github.com:Kilo-Org/kilocode.git")

          const requests: AgentStartRequest[] = []
          const keys: string[] = []
          const output: string[] = []
          const response = {
            cloudAgentSessionId: SESSION,
            kiloSessionId: "ses_command_test",
            messageId: MESSAGE,
            delivery: "queued" as const,
          }

          const result = yield* CloudCommands.start(
            {
              cwd: test.directory,
              prompt: "Inspect the current repository",
            },
            {
              env: { KILO_API_URL: server.url.origin, KILO_WEB_APP_URL: server.url.origin },
              make: (options) => {
                keys.push(options.apiKey)
                return {
                  async start(input) {
                    requests.push(input)
                    return response
                  },
                  async send() {
                    throw new Error("unused send")
                  },
                  async getMessageResult() {
                    throw new Error("unused result")
                  },
                }
              },
              write: (text) => output.push(text),
            },
          )

          expect(result).toEqual(response)
          expect(keys).toEqual([CONTROL])
          expect(requests).toHaveLength(1)
          expect(requests[0]).toEqual({
            message: { prompt: "Inspect the current repository" },
            agent: { mode: "plan", model: "anthropic/command-model" },
            repository: { type: "github", repo: "Kilo-Org/kilocode" },
            options: {
              createdOnPlatform: "kilo-cli",
              kilocodeOrganizationId: ORG,
            },
          })
          expect(requests[0]?.repository).not.toHaveProperty("branch")
          expect(output).toEqual([JSON.stringify(response) + "\n"])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  {
    git: true,
    config: {
      default_agent: "plan",
      agent: { plan: { model: "kilo/anthropic/command-model" } },
    },
  },
)

it.instance(
  "streams WebSocket events when --stream is passed",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === "/api/cloud-agent-next/token") return control()
            if (url.pathname.endsWith("/models")) {
              return Response.json({ data: [{ id: "anthropic/command-model", supported_parameters: ["tools"] }] })
            }
            if (url.pathname.endsWith("/defaults")) {
              return Response.json({ defaultModel: "anthropic/command-model" })
            }
            return new Response(null, { status: 404 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const output: string[] = []
          const ticketCalls: { cloudAgentSessionId: string; organizationId?: string }[] = []
          const streamCalls: string[] = []
          const response = {
            cloudAgentSessionId: SESSION,
            kiloSessionId: "ses_stream_test",
            messageId: MESSAGE,
            delivery: "queued" as const,
            streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=inlined",
          }

          const result = yield* CloudCommands.start(
            {
              cwd: test.directory,
              prompt: "Inspect the repository",
              repo: "Kilo-Org/kilocode",
              stream: true,
            },
            {
              env: { KILO_API_URL: server.url.origin, KILO_WEB_APP_URL: server.url.origin },
              make: () => ({
                async start() {
                  return response
                },
                async send() {
                  throw new Error("unused")
                },
                async getMessageResult() {
                  throw new Error("unused")
                },
              }),
              createStreamTicketClient: () => ({
                async fetchTicket(input) {
                  ticketCalls.push(input)
                  return { ticket: "should-not-be-used", expiresAt: 0 }
                },
              }),
              streamAgentEvents: async (options) => {
                streamCalls.push(options.streamUrl)
                await options.writeLine('{"event":"one"}')
                await options.writeLine('{"streamEventType":"complete","data":{"exitCode":0}}')
              },
              write: (text) => output.push(text),
            },
          )

          expect(result).toEqual(response)
          expect(ticketCalls).toEqual([])
          expect(streamCalls).toEqual(["/stream?cloudAgentSessionId=agent_123&ticket=inlined"])
          expect(output).toEqual([
            JSON.stringify({ ...response, streamUrl: undefined }) + "\n",
            '{"event":"one"}\n',
            '{"streamEventType":"complete","data":{"exitCode":0}}\n',
          ])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  {
    git: true,
    config: {
      default_agent: "plan",
      agent: { plan: { model: "kilo/anthropic/command-model" } },
    },
  },
)

it.instance(
  "fetches a stream ticket when the response omits streamUrl",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === "/api/cloud-agent-next/token") return control()
            if (url.pathname.endsWith("/models")) {
              return Response.json({ data: [{ id: "anthropic/command-model", supported_parameters: ["tools"] }] })
            }
            if (url.pathname.endsWith("/defaults")) {
              return Response.json({ defaultModel: "anthropic/command-model" })
            }
            return new Response(null, { status: 404 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const output: string[] = []
          const ticketCalls: { cloudAgentSessionId: string; organizationId?: string }[] = []
          const streamCalls: string[] = []
          const response = {
            cloudAgentSessionId: SESSION,
            kiloSessionId: "ses_stream_test",
            messageId: MESSAGE,
            delivery: "queued" as const,
          }

          yield* CloudCommands.start(
            {
              cwd: test.directory,
              prompt: "Inspect the repository",
              repo: "Kilo-Org/kilocode",
              orgID: ORG,
              stream: true,
            },
            {
              env: { KILO_API_URL: server.url.origin, KILO_WEB_APP_URL: server.url.origin },
              make: () => ({
                async start() {
                  return response
                },
                async send() {
                  throw new Error("unused")
                },
                async getMessageResult() {
                  throw new Error("unused")
                },
              }),
              createStreamTicketClient: () => ({
                async fetchTicket(input) {
                  ticketCalls.push(input)
                  return { ticket: "derived-tok", expiresAt: 1234567890 }
                },
              }),
              streamAgentEvents: async (options) => {
                streamCalls.push(options.streamUrl)
                await options.writeLine('{"event":"derived"}')
              },
              write: (text) => output.push(text),
            },
          )

          expect(ticketCalls).toEqual([{ cloudAgentSessionId: SESSION, organizationId: ORG }])
          expect(streamCalls).toEqual([`/stream?cloudAgentSessionId=${SESSION}&ticket=derived-tok`])
          expect(output).toEqual([JSON.stringify(response) + "\n", '{"event":"derived"}\n'])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  {
    git: true,
    config: {
      default_agent: "plan",
      agent: { plan: { model: "kilo/anthropic/command-model" } },
    },
  },
)

it.instance(
  "keeps admission successful when stream ticket acquisition fails",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === "/api/cloud-agent-next/token") return control()
            if (url.pathname.endsWith("/models")) {
              return Response.json({ data: [{ id: "anthropic/command-model", supported_parameters: ["tools"] }] })
            }
            if (url.pathname.endsWith("/defaults")) {
              return Response.json({ defaultModel: "anthropic/command-model" })
            }
            return new Response(null, { status: 404 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const output: string[] = []
          const response = {
            cloudAgentSessionId: SESSION,
            kiloSessionId: "ses_stream_test",
            messageId: MESSAGE,
            delivery: "queued" as const,
          }

          const result = yield* CloudCommands.start(
            {
              cwd: test.directory,
              prompt: "Inspect the repository",
              repo: "Kilo-Org/kilocode",
              stream: true,
            },
            {
              env: { KILO_API_URL: server.url.origin, KILO_WEB_APP_URL: server.url.origin },
              make: () => ({
                async start() {
                  return response
                },
                async send() {
                  throw new Error("unused")
                },
                async getMessageResult() {
                  throw new Error("unused")
                },
              }),
              createStreamTicketClient: () => ({
                async fetchTicket() {
                  throw new CloudError("Unable to obtain stream ticket")
                },
              }),
              streamAgentEvents: async () => {
                throw new Error("unused")
              },
              write: (text) => output.push(text),
            },
          )

          expect(result).toEqual(response)
          expect(output).toEqual([
            JSON.stringify(response) + "\n",
            JSON.stringify({ streamEventType: "error", data: { message: "Unable to obtain stream ticket" } }) + "\n",
          ])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  {
    git: true,
    config: {
      default_agent: "plan",
      agent: { plan: { model: "kilo/anthropic/command-model" } },
    },
  },
)

it.instance(
  "keeps a successful admission successful when the follow-up stream fails",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === "/api/cloud-agent-next/token") return control()
            if (url.pathname.endsWith("/models")) {
              return Response.json({ data: [{ id: "anthropic/command-model", supported_parameters: ["tools"] }] })
            }
            if (url.pathname.endsWith("/defaults")) {
              return Response.json({ defaultModel: "anthropic/command-model" })
            }
            return new Response(null, { status: 404 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const output: string[] = []
          const response = {
            cloudAgentSessionId: SESSION,
            kiloSessionId: "ses_stream_test",
            messageId: MESSAGE,
            delivery: "queued" as const,
            streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=inlined",
          }

          const result = yield* CloudCommands.start(
            {
              cwd: test.directory,
              prompt: "Inspect the repository",
              repo: "Kilo-Org/kilocode",
              stream: true,
            },
            {
              env: { KILO_API_URL: server.url.origin, KILO_WEB_APP_URL: server.url.origin },
              make: () => ({
                async start() {
                  return response
                },
                async send() {
                  throw new Error("unused")
                },
                async getMessageResult() {
                  throw new Error("unused")
                },
              }),
              streamAgentEvents: async () => {
                throw new Error("stream failed after admission")
              },
              write: (text) => output.push(text),
            },
          )

          expect(result).toEqual(response)
          expect(output).toEqual([
            JSON.stringify({ ...response, streamUrl: undefined }) + "\n",
            JSON.stringify({ streamEventType: "error", data: { message: "Cloud Agent stream failed" } }) + "\n",
          ])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  {
    git: true,
    config: {
      default_agent: "plan",
      agent: { plan: { model: "kilo/anthropic/command-model" } },
    },
  },
)

it.instance("sends follow-ups, prints status without assistant content, and applies the result exit code", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: control })),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const output: string[] = []
    const exits: number[] = []
    const sends: AgentSendRequest[] = []
    const sent = {
      cloudAgentSessionId: SESSION,
      status: "started" as const,
      streamUrl: "wss://cloud-agent.example/stream",
      messageId: MESSAGE,
      delivery: "queued" as const,
    }
    const results: MessageResult[] = [
      {
        cloudAgentSessionId: SESSION,
        messageId: MESSAGE,
        status: "completed",
        createdAt: 1,
        terminalAt: 2,
        assistant: { messageId: "assistant_1", text: "done" },
      },
      {
        cloudAgentSessionId: SESSION,
        messageId: MESSAGE,
        status: "failed",
        createdAt: 1,
        terminalAt: 2,
        failure: { retryable: false },
      },
    ]
    const deps = {
      env: { KILO_ORG_ID: "not-relevant-to-existing-sessions", KILO_WEB_APP_URL: server.url.origin },
      make: () => ({
        async start() {
          throw new Error("unused start")
        },
        async send(input: AgentSendRequest) {
          sends.push(input)
          return sent
        },
        async getMessageResult() {
          const result = results.shift()
          if (!result) throw new Error("missing test result")
          return result
        },
      }),
      write: (text: string) => output.push(text),
      exit: (code: number) => exits.push(code),
    }

    yield* CloudCommands.send({ sessionID: SESSION, prompt: "Continue" }, deps)
    yield* CloudCommands.status({ sessionID: SESSION, messageID: MESSAGE }, deps)
    yield* CloudCommands.result({ sessionID: SESSION, messageID: MESSAGE }, deps)

    expect(sends).toEqual([{ cloudAgentSessionId: SESSION, message: { prompt: "Continue" } }])
    expect(output).toEqual([
      JSON.stringify({ ...sent, streamUrl: undefined }) + "\n",
      JSON.stringify({
        cloudAgentSessionId: SESSION,
        messageId: MESSAGE,
        status: "completed",
        createdAt: 1,
        terminalAt: 2,
      }) + "\n",
      JSON.stringify({
        cloudAgentSessionId: SESSION,
        messageId: MESSAGE,
        status: "failed",
        createdAt: 1,
        terminalAt: 2,
        failure: { retryable: false },
      }) + "\n",
    ])
    expect(exits).toEqual([3])

    const error = yield* CloudCommands.send(
      { sessionID: SESSION, prompt: "Do not duplicate" },
      { ...deps, write: () => Promise.reject(new Error("closed output")) },
    ).pipe(Effect.flip)
    expect(error.message).toBe(
      "Cloud Agent send was admitted but output could not be written; do not retry automatically",
    )
  }),
)

it.instance("exchanges credentials before cloud commands and never sends source credentials to the worker", () =>
  Effect.gen(function* () {
    const calls: { path: string; auth: string | null; org: string | null; body: string }[] = []
    const output: string[] = []
    let status = 200
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const url = new URL(request.url)
            if (url.pathname.endsWith("/models")) {
              return Response.json({ data: [{ id: "anthropic/command-model", supported_parameters: ["tools"] }] })
            }
            if (url.pathname.endsWith("/defaults")) {
              return Response.json({ defaultModel: "anthropic/command-model" })
            }
            const body = request.method === "POST" ? await request.text() : ""
            calls.push({
              path: url.pathname,
              auth: request.headers.get("authorization"),
              org: request.headers.get("x-kilocode-organizationid"),
              body,
            })
            if (url.pathname === "/api/cloud-agent-next/token") {
              if (status !== 200) return Response.json({ error: TOKEN }, { status })
              return control()
            }
            if (request.headers.get("authorization") !== `Bearer ${CONTROL}`) {
              return new Response(null, { status: 400 })
            }
            const input =
              url.pathname === "/trpc/getMessageResult"
                ? GetMessageResultInputSchema.parse(JSON.parse(url.searchParams.get("input") ?? "null"))
                : undefined
            const id = input
              ? input.messageId
              : url.pathname === "/trpc/start"
                ? AgentStartRequestSchema.parse(JSON.parse(body)).message.id
                : AgentSendRequestSchema.parse(JSON.parse(body)).message.id
            return Response.json({
              result: {
                data: {
                  cloudAgentSessionId: SESSION,
                  kiloSessionId: "ses_command_test",
                  messageId: id,
                  delivery: "queued",
                  status: input ? "completed" : "started",
                  createdAt: 1,
                  terminalAt: 2,
                  streamUrl: "/stream?ticket=test",
                },
              },
            })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const deps = {
      env: {
        KILO_API_URL: server.url.origin,
        KILO_WEB_APP_URL: server.url.origin,
        CLOUD_AGENT_NEXT_BASE_URL: server.url.origin,
      },
      write: (text: string) => output.push(text),
      exit: () => undefined,
    }
    const start = { prompt: "Inspect the repository", repo: "Kilo-Org/kilocode", mode: "code", orgID: ORG }
    const result = yield* CloudCommands.start(start, deps)
    yield* CloudCommands.send({ sessionID: SESSION, prompt: "Continue" }, deps)
    yield* CloudCommands.status({ sessionID: SESSION, messageID: result.messageId }, deps)
    yield* CloudCommands.result({ sessionID: SESSION, messageID: result.messageId }, deps)

    const issued = calls.filter((call) => call.path === "/api/cloud-agent-next/token")
    const worker = calls.filter((call) => call.path.startsWith("/trpc/"))
    expect(issued).toHaveLength(4)
    expect(issued.every((call) => call.auth === `Bearer ${TOKEN}`)).toBe(true)
    expect(issued.at(0)).toMatchObject({ org: ORG, body: JSON.stringify({ organizationId: ORG }) })
    expect(issued.slice(1).every((call) => call.org === null && call.body === "{}")).toBe(true)
    expect(worker.map((call) => call.path)).toEqual([
      "/trpc/start",
      "/trpc/send",
      "/trpc/getMessageResult",
      "/trpc/getMessageResult",
    ])
    expect(worker.every((call) => call.auth === `Bearer ${CONTROL}` && !call.body.includes(TOKEN))).toBe(true)
    expect(output.join("")).not.toContain(TOKEN)
    expect(output.join("")).not.toContain(CONTROL)

    for (const code of [401, 503]) {
      status = code
      const error = yield* CloudCommands.start(start, deps).pipe(Effect.flip)
      expect(error.message).toBe(
        code === 401
          ? "Kilo Cloud denied the control token request"
          : "Kilo Cloud token issuance is temporarily unavailable",
      )
      expect(error.message).not.toContain(TOKEN)
    }
    expect(calls.filter((call) => call.path === "/api/cloud-agent-next/token")).toHaveLength(6)
    expect(calls.filter((call) => call.path.startsWith("/trpc/"))).toHaveLength(4)
  }),
)
