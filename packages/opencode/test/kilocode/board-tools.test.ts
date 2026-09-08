import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "../../src/config/config"
import { Truncate } from "../../src/tool/truncate"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { BackgroundJob } from "../../src/background/job"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Permission } from "../../src/permission"
import { Tool } from "../../src/tool/tool"
import { ToolRegistry } from "../../src/tool/registry"
import { BoardReadTool, BoardPostTool } from "../../src/kilocode/tool/board"
import { BoardStore } from "../../src/kilocode/board/store"
import { KiloTask } from "../../src/kilocode/tool/task"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      ToolRegistry.node,
      SessionProjector.node,
      Permission.node,
      Session.node,
      SessionStatus.node,
      BackgroundJob.node,
      Agent.node,
      Config.node,
      Database.node,
      Truncate.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)
const options = { config: { experimental: { shared_agent_board: true }, snapshot: false } }

const seed = Effect.fn("BoardToolTest.seed")(function* (title: string) {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({ title })
  const message = MessageID.ascending()
  yield* sessions.updateMessage({
    id: message,
    sessionID: session.id,
    role: "user",
    agent: "code",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID: session.id,
    messageID: message,
    type: "text",
    text: "Investigate the shared objective",
  })
  return { session, message }
})

const context = Effect.fn("BoardToolTest.context")(function* (sessionID: SessionID, messageID: MessageID) {
  const sessions = yield* Session.Service
  const agents = yield* Agent.Service
  const permission = yield* Permission.Service
  const session = yield* sessions.get(sessionID)
  const agent = yield* agents.get("code")
  if (!agent) throw new Error("Missing code agent")
  const callID = "board-call"
  return {
    sessionID,
    messageID,
    callID,
    agent: agent.name,
    abort: AbortSignal.any([]),
    messages: yield* sessions.messages({ sessionID }),
    metadata: () => Effect.void,
    ask: (request) =>
      KiloSessionPrompt.askPermission({
        permission,
        agents,
        sessions,
        session,
        agent,
        request: { ...request, sessionID, tool: { messageID, callID } },
      }).pipe(Effect.asVoid, Effect.orDie),
  } satisfies Tool.Context
})

afterEach(async () => {
  await disposeAllInstances()
})

describe("shared board tools", () => {
  it.live("uses runtime identity, isolates roots, and deduplicates tool retries", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const root = yield* seed("Root")
          const other = yield* seed("Other root")
          const ctx = yield* context(root.session.id, root.message)
          const post = yield* Tool.init(yield* BoardPostTool)
          const read = yield* Tool.init(yield* BoardReadTool)
          expect(Object.keys(post.parameters.fields)).toEqual(["to", "type", "body", "reply_to"])
          expect(Object.keys(read.parameters.fields)).toEqual(["since", "limit"])
          expect(read.description).toContain("before continuing affected work")
          expect(read.description).toContain(
            "Reading history does not show whether other participants have read messages",
          )
          expect(post.description).toContain("not personal bookkeeping")
          expect(post.description).toContain("your own board_read is not proof")
          expect(read.description).toContain(
            "For incremental reads, set since to your last successful board_read cursor",
          )
          expect(read.description).toContain("never a post or Task result ID")
          expect(read.description).toContain("When board coordination is in use")
          expect(read.description).toContain("do not reread solely because a Task")
          expect(post.description).toContain("Include evidence with candidate results")
          expect(post.description).toContain("Respect requested independence and communication limits")
          expect(post.description).toContain("including parents, children, and background siblings, not yourself")
          expect(post.description).toContain("ALL only for team-wide updates")
          expect(post.description).toContain("Posts do not wake, assign, cancel, or resume workers")
          expect(post.description).toContain(
            "Task with a returned task_id only for additional authorized work on your own child",
          )
          expect(post.description).toContain("Do not resume workers just to deliver a note or obtain a read receipt")
          expect(post.description).toContain("not proof that a recipient is active")
          const params = {
            to: "ALL",
            type: "INFO" as const,
            body: "ROOT_NOTE",
            from: "forged-sender",
            fromLabel: "Forged sender title",
            toLabel: "Forged recipient title",
            sessionID: other.session.id,
          }
          const result = yield* post.execute(params, ctx)
          expect(JSON.parse(result.output)).toMatchObject({ from: "main", to: "ALL", type: "INFO", body: "ROOT_NOTE" })
          expect(result.metadata).toMatchObject({ from: "main", fromLabel: "Root", to: "ALL", truncated: false })
          expect(JSON.parse(result.output).fromLabel).toBe("Root")
          expect(JSON.parse(result.output)).not.toHaveProperty("toLabel")
          expect(result.metadata).not.toHaveProperty("toLabel")
          const repeated = yield* post.execute(params, ctx)
          expect(repeated.metadata.id).toBe(result.metadata.id)
          yield* BoardStore.post({
            sessionID: other.session.id,
            messageID: other.message,
            callID: "other",
            to: "ALL",
            type: "INFO",
            body: "OTHER_BOARD_NOTE",
          })
          const redirected = { sessionID: other.session.id, limit: 20 }
          const history = yield* read.execute(redirected, ctx)
          expect(JSON.parse(history.output)).toMatchObject({ messages: [{ body: "ROOT_NOTE" }], hasMore: false })
          expect(history.output).not.toContain("OTHER_BOARD_NOTE")
          expect(history.metadata.truncated).toBe(false)
        }),
      options,
    ),
  )

  it.live("normalizes empty optional fields without dropping real reply IDs", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const root = yield* seed("Optional board fields")
          const ctx = yield* context(root.session.id, root.message)
          const post = yield* Tool.init(yield* BoardPostTool)
          const read = yield* Tool.init(yield* BoardReadTool)
          const params = { to: "ALL", type: "INFO" as const, body: "Top-level note" }
          const initial = yield* post.execute(params, ctx)
          expect(initial.metadata.availability.total).toBe(0)
          expect(JSON.parse(initial.output)).not.toHaveProperty("warning")
          for (const value of ["", " \t ", null, undefined]) {
            const result = yield* post.execute({ ...params, reply_to: value }, ctx)
            expect(result.metadata.id).toBe(initial.metadata.id)
            expect(JSON.parse(result.output)).not.toHaveProperty("reply_to")
            const history = yield* read.execute({ since: value, limit: null }, ctx)
            expect(JSON.parse(history.output).messages).toHaveLength(1)
          }
          const reply = yield* post.execute(
            { ...params, body: "Reply note", reply_to: ` ${initial.metadata.id} ` },
            { ...ctx, callID: "reply" },
          )
          expect(JSON.parse(reply.output).reply_to).toBe(initial.metadata.id)
          const page = yield* read.execute({ since: ` ${initial.metadata.id} `, limit: 1 }, ctx)
          expect(JSON.parse(page.output).messages).toMatchObject([
            { id: reply.metadata.id, reply_to: initial.metadata.id },
          ])
          const invalid = yield* Effect.exit(
            post.execute({ ...params, reply_to: "board_missing" }, { ...ctx, callID: "invalid" }),
          )
          expect(Exit.isFailure(invalid)).toBe(true)
          if (Exit.isFailure(invalid))
            expect(Cause.pretty(invalid.cause)).toContain("Reply message is not on this board")
          const cursor = yield* Effect.exit(read.execute({ since: "board_missing" }, ctx))
          expect(Exit.isFailure(cursor)).toBe(true)
          if (Exit.isFailure(cursor)) expect(Cause.pretty(cursor.cause)).toContain("Board cursor is not valid")
          expect((yield* BoardStore.read({ sessionID: root.session.id })).messages).toHaveLength(2)
        }),
      options,
    ),
  )

  it.live("reports invocation state and post-time availability without resuming recipients", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const jobs = yield* BackgroundJob.Service
          const status = yield* SessionStatus.Service
          const root = yield* seed("Inactive recipient")
          const child = yield* sessions.create({ parentID: root.session.id, title: "Worker" })
          const ctx = yield* context(root.session.id, root.message)
          const post = yield* Tool.init(yield* BoardPostTool)
          const read = yield* Tool.init(yield* BoardReadTool)
          const send = (to: string, call: string) =>
            post.execute({ to, type: "INFO", body: "Follow-up work" }, { ...ctx, callID: call })
          const observed = Effect.gen(function* () {
            const result = yield* read.execute({}, ctx)
            expect(result.metadata.participants).toEqual(JSON.parse(result.output).participants)
            expect(result.metadata.observedAt).toBe(JSON.parse(result.output).observedAt)
            return result.metadata.participants.find((item) => item.sessionID === child.id)?.state
          })

          const unknown = yield* send(child.id, "unknown")
          expect(unknown.metadata).toMatchObject({ fromLabel: root.session.title, toLabel: child.title })
          expect(JSON.parse(unknown.output)).toMatchObject({ fromLabel: root.session.title, toLabel: child.title })
          expect(unknown.metadata.availability).toMatchObject({ total: 1, active: 0, inactive: 0, unknown: 1 })
          expect(JSON.parse(unknown.output).warning).toContain("Availability was unknown")
          expect(yield* observed).toBe("unknown")
          const self = yield* Effect.exit(send("main", "main"))
          expect(self._tag).toBe("Failure")
          if (Exit.isFailure(self)) expect(Cause.pretty(self.cause)).toContain("cannot be sent to yourself")
          const own = yield* Effect.exit(
            post.execute(
              { to: child.id, type: "INFO", body: "Note to self" },
              yield* context(child.id, MessageID.ascending()),
            ),
          )
          expect(own._tag).toBe("Failure")
          if (Exit.isFailure(own)) expect(Cause.pretty(own.cause)).toContain("cannot be sent to yourself")
          yield* jobs.start({ id: child.id, type: "task", run: Effect.never })
          const running = yield* send(child.id, "running")
          expect(JSON.parse(running.output)).not.toHaveProperty("warning")
          expect(JSON.parse(running.output).receipt).toContain("does not confirm delivery, reading, or action")
          expect(running.metadata.availability).toMatchObject({ total: 1, active: 1, inactive: 0, unknown: 0 })
          expect(yield* observed).toBe("running")
          yield* jobs.cancel(child.id)

          for (const state of ["cancelled", "error", "completed"] as const) {
            if (state !== "cancelled") {
              yield* jobs.start({
                id: child.id,
                type: "task",
                run: state === "error" ? Effect.fail(new Error("Task failed")) : Effect.succeed("Done"),
              })
            }
            const before = (yield* jobs.wait({ id: child.id, timeout: 1_000 })).info
            expect(before?.status).toBe(state)
            const result = yield* send(child.id, state)
            expect(JSON.parse(result.output)).toMatchObject({
              to: child.id,
              body: "Follow-up work",
              availability: { total: 1, active: 0, inactive: 1, unknown: 0 },
            })
            expect(JSON.parse(result.output).warning).toContain("finished invocations at this post attempt")
            expect(yield* observed).toBe(state)
            expect(result.metadata.availability).toEqual(JSON.parse(result.output).availability)
            expect((yield* send(child.id, state)).metadata.id).toBe(result.metadata.id)
            expect(yield* jobs.get(child.id)).toEqual(before)
            expect((yield* status.get(child.id)).type).toBe("idle")
            const history = yield* BoardStore.read({ sessionID: root.session.id })
            expect(history.messages.filter((message) => message.id === result.metadata.id)).toHaveLength(1)
            expect(history.messages.some((message) => Object.hasOwn(message, "warning"))).toBe(false)
          }
          yield* status.set(root.session.id, { type: "busy" })
          const broadcast = yield* send("ALL", "broadcast")
          expect(broadcast.metadata.availability).toMatchObject({ total: 1, active: 0, inactive: 1, unknown: 0 })
          expect(JSON.parse(broadcast.output).warning).toContain("No other recipients were active at this post attempt")
          expect((yield* jobs.get(child.id))?.status).toBe("completed")
          yield* status.set(root.session.id, { type: "idle" })
          const missing = yield* sessions.create({ parentID: root.session.id, title: "Unknown worker" })
          const mixed = yield* send("ALL", "mixed")
          expect(mixed.metadata.availability).toMatchObject({ total: 2, active: 0, inactive: 1, unknown: 1 })
          expect(JSON.parse(mixed.output).warning).toContain("Availability was unknown")
          expect(JSON.parse(mixed.output).warning).not.toContain("No other recipients were active")
          yield* sessions.remove(missing.id)

          for (const value of [
            { type: "busy" },
            { type: "retry", attempt: 1, message: "Retrying", next: 1 },
            { type: "offline", requestID: "que_board", message: "Waiting" },
          ]) {
            const state = Schema.decodeUnknownSync(SessionStatus.Info)(value)
            yield* status.set(child.id, state)
            expect(JSON.parse((yield* send(child.id, state.type)).output)).not.toHaveProperty("warning")
            expect(yield* status.get(child.id)).toEqual(state)
            expect(String(yield* observed)).toBe(state.type)
          }
          yield* status.set(child.id, { type: "idle" })
          yield* jobs.start({ id: child.id, type: "other", run: Effect.succeed("Done") })
          yield* jobs.wait({ id: child.id, timeout: 1_000 })
          expect((yield* send(child.id, "other")).metadata.availability.unknown).toBe(1)
          expect(yield* observed).toBe("unknown")
          expect(yield* sessions.messages({ sessionID: child.id })).toEqual([])
        }),
      options,
    ),
  )

  it.live("is absent by default and rejects direct execution while disabled", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        expect(yield* registry.ids()).not.toContain("board_read")
        expect(yield* registry.ids()).not.toContain("board_post")
        const root = yield* seed("Disabled")
        const ctx = yield* context(root.session.id, root.message)
        const post = yield* Tool.init(yield* BoardPostTool)
        const result = yield* Effect.exit(post.execute({ to: "ALL", type: "INFO", body: "Not posted" }, ctx))
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("shared agent board is disabled")
        expect((yield* BoardStore.read({ sessionID: root.session.id })).messages).toHaveLength(0)
      }),
    ),
  )

  it.live("allows read-only participants without granting workspace writes", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agents = yield* Agent.Service
          const registry = yield* ToolRegistry.Service
          const ids = yield* registry.ids()
          expect(ids).toContain("board_read")
          expect(ids).toContain("board_post")
          for (const name of ["code", "general", "explore", "plan", "ask"]) {
            const agent = yield* agents.get(name)
            expect(agent).toBeDefined()
            expect(Permission.evaluate("board_read", "*", agent?.permission ?? []).action).toBe("allow")
            expect(Permission.evaluate("board_post", "*", agent?.permission ?? []).action).toBe("allow")
            if (["explore", "plan", "ask"].includes(name)) {
              expect(Permission.evaluate("edit", "src/example.ts", agent?.permission ?? []).action).toBe("deny")
            }
          }
          for (const name of ["title", "summary", "compaction"]) {
            const agent = yield* agents.get(name)
            expect(Permission.evaluate("board_read", "*", agent?.permission ?? []).action).toBe("deny")
          }
          const caller = yield* agents.get("code")
          if (!caller) throw new Error("Missing code agent")
          const denied = KiloTask.inherited({
            caller: { ...caller, permission: Permission.fromConfig({ "*": "allow", "board_*": "deny" }) },
            session: {},
            mcp: {},
          })
          expect(Permission.evaluate("board_read", "*", caller.permission, denied).action).toBe("deny")
          expect(Permission.evaluate("board_post", "*", caller.permission, denied).action).toBe("deny")
          const baseline = KiloTask.inherited({
            caller: { ...caller, permission: Permission.fromConfig({ "*": "deny", read: "allow" }) },
            session: {},
            mcp: {},
          })
          expect(baseline.some((rule) => rule.permission.startsWith("board_"))).toBe(false)
        }),
      options,
    ),
  )

  it.live("keeps explicit user denials effective for all participant modes", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agents = yield* Agent.Service
          for (const name of ["code", "general", "explore", "plan", "ask"]) {
            const agent = yield* agents.get(name)
            expect(Permission.evaluate("board_read", "*", agent?.permission ?? []).action).toBe("deny")
            expect(Permission.evaluate("board_post", "*", agent?.permission ?? []).action).toBe("deny")
          }
          const root = yield* seed("Denied")
          const ctx = yield* context(root.session.id, root.message)
          const read = yield* Tool.init(yield* BoardReadTool)
          const result = yield* Effect.exit(read.execute({}, ctx))
          expect(Exit.isFailure(result)).toBe(true)
        }),
      {
        config: { experimental: { shared_agent_board: true }, permission: { board_read: "deny", board_post: "deny" } },
      },
    ),
  )
})
