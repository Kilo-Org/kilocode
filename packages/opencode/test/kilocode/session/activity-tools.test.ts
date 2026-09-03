import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Database } from "@opencode-ai/core/database/database"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Effect, Fiber, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Activity } from "@/kilocode/session/activity"
import { Suggestion } from "@/kilocode/suggestion"
import { SuggestTool } from "@/kilocode/suggestion/tool"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { CodeModeTool } from "@/tool/code-mode"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionStatus.node,
      Permission.node,
      Session.node,
      SessionProjector.node,
      Agent.node,
      Plugin.node,
      Truncate.node,
      Command.node,
      Config.node,
      Database.node,
    ]),
  ),
)

const working = (status: SessionStatus.Interface, id: SessionID) =>
  Effect.map(SessionStatus.snapshot(status), (items) => items.get(id)?.working ?? false)

for (const scenario of ["parallel", "waiting", "cached", "eager", "race", "cancel"] as const) {
  it.instance(
    `tracks real code-mode inner calls: ${scenario}`,
    () =>
      Effect.gen(function* () {
        const parallel = scenario === "parallel" || scenario === "race"
        const status = yield* SessionStatus.Service
        const permission = yield* Permission.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Code-mode activity" })
        const message = MessageID.ascending()
        const abort = new AbortController()
        const started = Promise.withResolvers<void>()
        const done = Promise.withResolvers<void>()
        const client = new Client({ name: "activity", version: "1" })
        const server = new Server({ name: "activity", version: "1" }, { capabilities: { tools: {} } })
        const tools = Object.fromEntries(
          ["first", "second"].map((name) => [
            `activity_${name}`,
            {
              def: { name, description: name, inputSchema: { type: "object", properties: {} } },
              clientName: "activity",
              client,
            } satisfies MCP.McpTool,
          ]),
        )
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: Object.values(tools).map((tool) => tool.def),
        }))
        server.setRequestHandler(CallToolRequestSchema, async (input) => {
          if ((input.params.name === "second" && parallel) || scenario === "waiting" || scenario === "cached") {
            started.resolve()
            await done.promise
          }
          return { content: [{ type: "text", text: input.params.name }] }
        })
        const [local, remote] = InMemoryTransport.createLinkedPair()
        yield* Effect.promise(() => server.connect(remote))
        yield* Effect.promise(() => client.connect(local))
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => Promise.all([client.close(), server.close()])).pipe(Effect.asVoid),
        )
        const make = CodeModeTool.pipe(
          Effect.flatMap(Tool.init),
          Effect.provide(
            Layer.mock(MCP.Service, {
              tools: () => Effect.succeed(tools),
              clients: () => Effect.succeed({ activity: client }),
            }),
          ),
        )
        const ctx: Tool.Context = {
          sessionID: session.id,
          messageID: message,
          callID: "execute",
          agent: "code",
          abort: abort.signal,
          messages: [],
          metadata: () => Effect.void,
          ask: (input) =>
            permission
              .ask({
                ...input,
                sessionID: session.id,
                tool: { messageID: message, callID: "execute" },
                ruleset: [
                  {
                    permission: "*",
                    pattern: "*",
                    action: parallel && input.permission === "activity_second" ? "allow" : "ask",
                  },
                ],
              })
              .pipe(Effect.asVoid, Effect.orDie),
        }
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            abort.abort()
            done.resolve()
            for (const item of yield* permission.list()) {
              if (item.sessionID === session.id)
                yield* permission.reply({ requestID: item.id, reply: "reject" }).pipe(Effect.ignore)
            }
          }),
        )
        const cached =
          scenario === "cached"
            ? yield* Activity.run(
                session.id,
                Effect.gen(function* () {
                  const tool = yield* make
                  expect((yield* tool.execute({ code: "return 1" }, ctx)).output).toBe("1")
                  return tool
                }),
              )
            : undefined
        yield* status.set(session.id, { type: "busy" })
        yield* Activity.run(
          session.id,
          Activity.request(
            message,
            Effect.gen(function* () {
              const tool = cached ?? (yield* make)
              const request = yield* Activity.Pending
              Activity.start(request)
              Activity.reserve(request, "execute")
              const code =
                scenario === "eager"
                  ? "tools.activity.first({}); while (true) {}"
                  : `return await Promise.${scenario === "race" ? "race" : "all"}([tools.activity.first({}), tools.activity.second({})])`
              const running = yield* tool.execute({ code }, ctx).pipe(Effect.forkChild)
              const pending = yield* pollWithTimeout(
                Effect.map(permission.list(), (items) => {
                  const pending = items.filter((item) => item.sessionID === session.id)
                  return pending.length === (parallel || scenario === "eager" ? 1 : 2) ? pending : undefined
                }),
                "Code-mode permissions did not open",
              )
              if (parallel) yield* Effect.promise(() => started.promise)
              expect(yield* working(status, session.id)).toBe(true)
              Activity.finish(request)
              if (scenario === "eager") {
                expect(yield* working(status, session.id)).toBe(true)
                abort.abort()
                expect((yield* Fiber.join(running)).output).toBe("Execution cancelled.")
                Activity.settle(request, "execute")
                return
              }
              if (parallel) {
                expect(yield* working(status, session.id)).toBe(true)
                done.resolve()
              }
              if (scenario === "race") {
                expect((yield* Fiber.join(running)).output).toBe("second")
                Activity.settle(request, "execute")
                return
              }
              yield* pollWithTimeout(
                Effect.map(working(status, session.id), (value) => (!value ? true : undefined)),
                "Code-mode remained active with only user waits",
              )
              if (scenario === "cancel") {
                abort.abort()
                expect((yield* Fiber.join(running)).output).toBe("Execution cancelled.")
                Activity.settle(request, "execute")
                return
              }
              for (const item of pending) yield* permission.reply({ requestID: item.id, reply: "once" })
              if (!parallel) {
                yield* Effect.promise(() => started.promise)
                expect(yield* working(status, session.id)).toBe(true)
                done.resolve()
              }
              expect(JSON.parse((yield* Fiber.join(running)).output)).toEqual(["first", "second"])
              Activity.settle(request, "execute")
              expect(yield* working(status, session.id)).toBe(true)
            }),
          ),
        )
        expect(yield* working(status, session.id)).toBe(false)
        yield* status.set(session.id, { type: "idle" })
        expect((yield* SessionStatus.snapshot(status)).has(session.id)).toBe(false)
      }),
    { config: { sandbox: { enabled: false, network: "deny" } } },
    15_000,
  )
}

it.instance("suspends only the real suggestion selection wait and resumes on accept", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const session = yield* (yield* Session.Service).create({ title: "Suggestion activity" })
    const message = MessageID.ascending()
    const tool = yield* SuggestTool.pipe(Effect.flatMap(Tool.init))
    const abort = new AbortController()
    yield* Effect.addFinalizer(() => Effect.promise(() => Suggestion.dismissAll(session.id)))
    yield* status.set(session.id, { type: "busy" })
    yield* Activity.run(
      session.id,
      Activity.request(
        message,
        Effect.gen(function* () {
          const request = yield* Activity.Pending
          Activity.start(request)
          Activity.reserve(request, "suggest")
          const running = yield* tool
            .execute(
              { suggest: "Continue?", actions: [{ label: "Continue", prompt: "Continue the work" }] },
              {
                sessionID: session.id,
                messageID: message,
                callID: "suggest",
                agent: "code",
                abort: abort.signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
            .pipe(Effect.forkChild)
          const pending = yield* pollWithTimeout(
            Effect.promise(() => Suggestion.list()).pipe(
              Effect.map((items) => items.find((item) => item.sessionID === session.id)),
            ),
            "Suggestion did not open",
          )
          expect(pending.blocking).toBe(false)
          expect(yield* working(status, session.id)).toBe(true)
          Activity.finish(request)
          yield* pollWithTimeout(
            Effect.map(working(status, session.id), (value) => (!value ? true : undefined)),
            "Suggestion kept the idle session active",
          )
          expect(yield* status.get(session.id)).toEqual({ type: "idle" })
          yield* Effect.promise(() => Suggestion.accept({ requestID: pending.id, index: 0 }))
          const result = yield* Fiber.join(running)
          expect(result.metadata.accepted?.prompt).toBe("Continue the work")
          expect(result.output).toContain("Continue the work")
          Activity.settle(request, "suggest")
          expect(yield* status.get(session.id)).toEqual({ type: "busy" })
          expect(yield* working(status, session.id)).toBe(true)
        }),
      ),
    )
    yield* status.set(session.id, { type: "idle" })
    expect((yield* SessionStatus.snapshot(status)).has(session.id)).toBe(false)
  }),
)
