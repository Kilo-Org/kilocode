import { afterEach, describe, expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { Job } from "@opencode/core/job"
import { Message, ToolMessage, ToolResultPart } from "@opencode/ai/effect"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Session } from "@opencode/core/session"
import type { AssertInput } from "@opencode/plugin/permission"
import { Document } from "@opencode/schema/config"
import { KiloBoardRpc } from "@opencode/schema/kilocode/board"
import { SessionID } from "@opencode/schema/session-id"
import { Tool } from "@opencode/schema/tool"
import { DateTime, Effect, Exit, Queue, Schema, Scope, Stream } from "effect"
import { KiloBoard } from "../src/board"
import { BoardContext } from "../src/board/context"
import { BoardNotice } from "../src/board/notice"
import { DISABLED } from "../src/board/tool"
import { fixture } from "./board/support"

type Handlers = Record<string, (input: unknown, context: { error: (type: string, message: string) => unknown }) => Effect.Effect<unknown, unknown>>
type Hook = (event: Record<string, unknown>) => Effect.Effect<void, unknown>

const root = SessionID.make("ses_root")

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

// The plugin against a stand-in plugin context and location services: the board fixture's sessions, a mutable config
// document, and recorders for the tools, hooks, RPC handlers and RPC events it registers.
async function boot(options: { enabled?: boolean } = {}) {
  const board = fixture()
  const setting = { enabled: options.enabled }
  const transforms: ((editor: { add: (tool: Tool.Info) => void }) => void)[] = []
  const hooks: Record<string, Hook[]> = {}
  const asserts: AssertInput[] = []
  const emitted: KiloBoardRpc.Changed[] = []
  const handlers: { value?: Handlers } = {}
  const reloads = { count: 0 }
  const events = await Effect.runPromise(Queue.unbounded<{ type: string; data: Record<string, unknown> }>())
  const active = new Set<string>()
  const jobs = new Map<string, Job.Info>()
  const hook = (name: string, callback: Hook) =>
    Effect.sync(() => {
      hooks[name] = [...(hooks[name] ?? []), callback]
      return { dispose: Effect.void }
    })
  const ctx = {
    location: { directory: board.directory },
    storage: board.storage,
    rpc: {
      register: (_: unknown, value: Handlers) =>
        Effect.sync(() => {
          handlers.value = value
          return { dispose: Effect.void, events: { emit: (_: string, event: KiloBoardRpc.Changed) => Effect.sync(() => void emitted.push(event)) } }
        }),
    },
    tool: {
      transform: (fn: (typeof transforms)[number]) => Effect.sync(() => (transforms.push(fn), { dispose: Effect.void })),
      reload: () => Effect.sync(() => void reloads.count++),
      hook: (name: string, callback: Hook) => hook(`tool.${name}`, callback),
    },
    session: { hook: (name: string, callback: Hook) => hook(`session.${name}`, callback) },
    permission: {
      assert: (input: AssertInput) =>
        Effect.suspend(() => {
          asserts.push(input)
          return input.agent === "denied" ? Effect.fail(new Tool.Error({ message: "denied" })) : Effect.void
        }),
    },
    event: { subscribe: () => Stream.fromQueue(events) },
  }
  const config = {
    entries: () =>
      Effect.sync(() =>
        setting.enabled === undefined
          ? []
          : [new Document({ type: "document", info: new KiloConfigPolicy.Info({ shared_agent_board: setting.enabled }) })],
      ),
  } as unknown as Config.Interface
  const sessions = {
    get: (sessionID: string) => {
      const member = board.sessions.get(sessionID)
      if (!member) return Effect.fail(new Error("missing"))
      return Effect.succeed({
        id: member.id,
        parentID: member.parentID,
        projectID: member.projectID,
        title: member.title,
        agent: member.agent,
        location: { directory: member.directory },
        time: { created: DateTime.makeUnsafe(member.created), updated: DateTime.makeUnsafe(member.created) },
      })
    },
    list: (input: { parentID: string }) =>
      Effect.flatMap(
        Effect.forEach(
          [...board.sessions.values()].filter((member) => member.parentID === input.parentID),
          (member) => sessions.get(SessionID.make(member.id)),
        ),
        (data) => Effect.succeed({ data, cursor: {} }),
      ),
    active: Effect.sync(() => new Set(active)),
  } as unknown as Session.Interface
  const job = { get: (id: string) => Effect.sync(() => jobs.get(id)) } as unknown as Job.Interface
  const scope = await Effect.runPromise(Scope.make())
  closers.push(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  await Effect.runPromise(
    KiloBoard.Plugin.effect(ctx as never).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(Config.Service, config),
      Effect.provideService(Session.Service, sessions),
      Effect.provideService(Job.Service, job),
    ),
  )
  const tools = () => {
    const added: Tool.Info[] = []
    transforms.forEach((fn) => fn({ add: (tool) => added.push(tool) }))
    return Object.fromEntries(added.map((tool) => [tool.name, tool]))
  }
  const call = (name: string, input: unknown, sessionID = "ses_root", options: { agent?: string; id?: string; messageID?: string } = {}) => {
    const tool = tools()[name]
    const decoded = Schema.decodeUnknownSync(tool.input as Schema.Codec<unknown>)(input)
    return Effect.runPromise(
      tool.execute(decoded, {
        sessionID: sessionID as never,
        agent: (options.agent ?? "code") as never,
        messageID: (options.messageID ?? `msg_${Math.random()}`) as never,
        id: (options.id ?? `call_${Math.random()}`) as never,
        progress: () => Effect.void,
      }),
    )
  }
  const trigger = async (name: string, event: Record<string, unknown>) => {
    await Effect.runPromise(Effect.forEach(hooks[name] ?? [], (callback) => callback(event), { discard: true }))
    return event
  }
  const publish = async (event: { type: string; data: Record<string, unknown> }) => {
    await Effect.runPromise(Queue.offer(events, event))
    await Bun.sleep(5)
  }
  return { board, setting, tools, call, trigger, publish, asserts, emitted, handlers, reloads, active, jobs }
}

const content = (result: Tool.Result) => JSON.parse(result.content as string)

describe("shared board tools", () => {
  test("registers both tools by default, with the descriptions and parameters", async () => {
    const host = await boot()
    const tools = host.tools()
    expect(Object.keys(tools)).toEqual(["board_read", "board_post"])
    expect(tools.board_read.description).toStartWith(
      "Read the shared board for this main session and its subagent children when peer context is relevant",
    )
    expect(tools.board_post.description).toEndWith("The complete formatted message must fit within 4 KiB.")
  })

  test("is absent when config disables it, and follows config changes", async () => {
    const host = await boot({ enabled: false })
    expect(Object.keys(host.tools())).toEqual([])
    host.setting.enabled = true
    await host.publish({ type: "config.updated", data: {} })
    expect(host.reloads.count).toBe(1)
    expect(Object.keys(host.tools())).toEqual(["board_read", "board_post"])
    expect(await Effect.runPromise(host.handlers.value!.status({}, { error: () => undefined }))).toEqual({ enabled: true })
  })

  test("rejects direct execution while disabled", async () => {
    const host = await boot()
    host.setting.enabled = false
    await expect(host.call("board_read", {})).rejects.toMatchObject({ message: DISABLED })
    expect(host.asserts).toEqual([])
  })

  test("uses runtime identity, asserts permissions, deduplicates retries and publishes the revision", async () => {
    const host = await boot()
    const identity = { id: "call_1", messageID: "msg_1" }
    const first = content(await host.call("board_post", { to: "ses_child", type: "ASK", body: "  Which schema?  ", reply_to: "" }, "ses_root", identity))
    expect(first).toMatchObject({ from: "main", to: "ses_child", type: "ASK", body: "Which schema?", toLabel: "Child" })
    expect(first.reply_to).toBeUndefined()
    expect(first.receipt).toBe(
      "Stored only. This does not confirm delivery, reading, or action, and does not wake recipients.",
    )
    expect(first.warning).toStartWith("The direct recipient's execution state was unknown at this post attempt.")
    const retry = content(await host.call("board_post", { to: "ses_child", type: "ASK", body: "Which schema?" }, "ses_root", identity))
    expect(retry.id).toBe(first.id)
    expect(host.emitted).toEqual([
      { sessionID: root, revision: 1 },
      { sessionID: root, revision: 1 },
    ])
    expect(host.asserts.map((input) => [input.action, input.resources, input.metadata])).toEqual([
      ["board_post", ["*"], { to: "ses_child", type: "ASK" }],
      ["board_post", ["*"], { to: "ses_child", type: "ASK" }],
    ])
    await expect(host.call("board_read", {}, "ses_child", { agent: "denied" })).rejects.toMatchObject({ message: "denied" })
  })

  test("reports execution state and post-time availability without changing it", async () => {
    const host = await boot()
    host.active.add("ses_child")
    host.jobs.set("ses_sibling", { id: "ses_sibling", type: "subagent", status: "completed", started_at: 5 })
    const result = await host.call("board_post", { to: "ALL", type: "INFO", body: "Heads up" })
    expect(content(result).availability).toMatchObject({ total: 2, active: 1, inactive: 1, unknown: 0 })
    expect(content(result).warning).toBe("1 recipient(s) had finished invocations at this post attempt.")
    const direct = content(await host.call("board_post", { to: "ses_sibling", type: "INFO", body: "Done?" }))
    expect(direct.warning).toStartWith("The direct recipient's state was completed at this post attempt.")
    const read = await host.call("board_read", { since: null, limit: null }, "ses_child")
    expect(read.metadata).toMatchObject({ hasMore: false, truncated: false, participantsTruncated: false })
    expect(content(read).participants).toEqual([
      { id: "main", sessionID: "ses_root", label: "Root", state: "unknown" },
      { id: "ses_child", sessionID: "ses_child", label: "Child", state: "busy", self: true },
      { id: "ses_sibling", sessionID: "ses_sibling", label: "Sibling", state: "completed" },
    ])
    expect(host.active).toEqual(new Set(["ses_child"]))
  })

  test("recovers from a stale cursor instead of failing", async () => {
    const host = await boot()
    await host.call("board_post", { to: "ALL", type: "INFO", body: "one" })
    const read = await host.call("board_read", { since: "board_gone" }, "ses_child")
    expect(content(read)).toMatchObject({ recovered: true, messages: [{ body: "one" }] })
    expect(read.metadata).toMatchObject({ recovered: true })
  })

  test("adds the instructions only to requests that offer board_read", async () => {
    const host = await boot()
    const offered = await host.trigger("session.context", {
      sessionID: "ses_child",
      tools: { board_read: {}, board_post: {} },
      system: [],
      messages: [],
    })
    expect(offered.system).toEqual([{ type: "text", text: BoardContext.instructions }])
    expect(BoardContext.instructions.split("\n")).toHaveLength(11)
    const hidden = await host.trigger("session.context", { sessionID: "ses_sibling", tools: {}, system: [], messages: [] })
    expect(hidden.system).toEqual([])
  })

  test("flags the next tool result after addressed activity once, for the model only", async () => {
    const host = await boot()
    await host.trigger("session.context", { sessionID: "ses_child", tools: { board_read: {} }, system: [], messages: [] })
    const after = (id: string, result: Tool.Result, sessionID = "ses_child") =>
      host.trigger("tool.execute.after", { tool: "read", id, sessionID, status: "completed", result }) as Promise<{
        result: Tool.Result
      }>
    expect((await after("call_1", { content: "plain" })).result).toEqual({ content: "plain" })
    await host.call("board_post", { to: "ses_sibling", type: "INFO", body: "not for child" })
    expect((await after("call_2", { content: "plain" })).result).toEqual({ content: "plain" })
    await host.call("board_post", { to: "ses_child", type: "INFO", body: "secret peer text" })
    // The stored result keeps the tool's content; only the marker is recorded.
    expect((await after("call_3", { content: "file body" })).result).toEqual({
      content: "file body",
      metadata: { [BoardNotice.key]: 2 },
    })
    expect((await after("call_4", { content: "again" })).result).toEqual({ content: "again" })
    // A session whose request did not offer the board gets no marker.
    await host.call("board_post", { to: "ALL", type: "INFO", body: "team" })
    expect((await after("call_5", { content: "x" }, "ses_sibling")).result).toEqual({ content: "x" })

    // Every later model request of the session carries the notice on the flagged call, and only there.
    const request = () =>
      host.trigger("session.context", {
        sessionID: "ses_child",
        tools: { board_read: {} },
        system: [],
        messages: [
          Message.make({
            role: "tool",
            content: ["call_2", "call_3"].map((id) =>
              ToolResultPart.make({ id, name: "read", result: id, resultType: "text" }),
            ),
          }),
        ],
      }) as Promise<{ messages: ToolMessage[] }>
    for (const event of [await request(), await request()]) {
      const results = event.messages[0].content.map((part) => part.result)
      expect(results).toEqual([
        { type: "text", value: "call_2" },
        { type: "text", value: `call_3\n\n${BoardNotice.text}` },
      ])
      expect(JSON.stringify(results)).not.toContain("secret peer text")
    }
    const compaction = (await host.trigger("session.compaction", {
      sessionID: "ses_child",
      messages: [Message.make({ role: "tool", content: [ToolResultPart.make({ id: "call_3", name: "read", result: "x", resultType: "text" })] })],
    })) as { messages: ToolMessage[] }
    expect(compaction.messages[0].content[0].result).toEqual({ type: "text", value: `x\n\n${BoardNotice.text}` })

    await host.publish({ type: "session.deleted", data: { sessionID: "ses_child" } })
    expect([...host.board.storage.entries.keys()].filter((key) => key.startsWith("notice/"))).toEqual([])
  })

  test("a board_read consumes what it returned", async () => {
    const host = await boot()
    await host.trigger("session.context", { sessionID: "ses_child", tools: { board_read: {} }, system: [], messages: [] })
    await host.call("board_post", { to: "ses_child", type: "INFO", body: "read me" })
    const read = await host.call("board_read", {}, "ses_child")
    const event = await host.trigger("tool.execute.after", {
      tool: "board_read",
      id: "call_read",
      sessionID: "ses_child",
      status: "completed",
      result: read,
    })
    expect(event.result).toBe(read)
  })

  test("serves the board RPC: read-only get, root-only reset with revision conflicts", async () => {
    const host = await boot()
    const rpc = host.handlers.value!
    const context = { error: (type: string, message: string) => ({ type, message }) }
    const empty = await Effect.runPromise(rpc.get({ sessionID: "ses_child" }, context))
    expect(empty).toEqual({ ownerSessionID: "ses_root", revision: 0, messages: [], hasMore: false })
    expect(host.board.storage.entries.size).toBe(0)
    await host.call("board_post", { to: "ALL", type: "INFO", body: "one" })
    expect(await Effect.runPromise(Effect.flip(rpc.get({ sessionID: "ses_missing" }, context)))).toEqual({
      type: "not_found",
      message: "Session not found: ses_missing",
    })
    expect(await Effect.runPromise(Effect.flip(rpc.reset({ sessionID: "ses_child", revision: 1 }, context)))).toEqual({
      type: "invalid",
      message: "Only the owning session can reset this board",
    })
    expect(await Effect.runPromise(Effect.flip(rpc.reset({ sessionID: "ses_root", revision: 0 }, context)))).toEqual({
      type: "conflict",
      message: "The board changed. Refresh it before clearing messages.",
    })
    host.emitted.splice(0)
    expect(await Effect.runPromise(rpc.reset({ sessionID: root, revision: 1 }, context))).toEqual({
      ownerSessionID: "ses_root",
      revision: 1,
      messages: [],
      hasMore: false,
    })
    expect(host.emitted).toEqual([{ sessionID: root, revision: 1 }])
  })
})
