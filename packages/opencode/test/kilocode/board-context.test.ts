import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Config } from "../../src/config/config"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { Permission } from "../../src/permission"
import { BoardContext } from "../../src/kilocode/board/context"
import { BoardStore } from "../../src/kilocode/board/store"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      SessionProjector.node,
      Config.node,
      Database.node,
      Agent.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)
const options = { config: { experimental: { shared_agent_board: true }, snapshot: false } }
const agent = { name: "code", permission: Permission.fromConfig({ board_read: "allow" }) }

function user(sessionID: SessionID): MessageV2.User {
  return {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    agent: "code",
    time: { created: Date.now() },
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
  }
}

const seed = Effect.fn("BoardContextTest.seed")(function* (sessionID: SessionID, text: string) {
  const sessions = yield* Session.Service
  const info = user(sessionID)
  yield* sessions.updateMessage(info)
  const part = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: info.id,
    sessionID,
    type: "text",
    text,
  })
  return { info, parts: [part] } satisfies MessageV2.WithParts
})

afterEach(async () => {
  await disposeAllInstances()
})

describe("shared board context", () => {
  test("returns request-tail context without rewriting the conversation prefix", () => {
    const info = user(SessionID.make("ses_board_cache"))
    const history: MessageV2.WithParts[] = [
      {
        info,
        parts: [
          {
            id: PartID.ascending(),
            sessionID: info.sessionID,
            messageID: info.id,
            type: "text",
            text: "Original task",
          },
        ],
      },
    ]
    const before = structuredClone(history)
    const snapshot = {
      target: info.id,
      text: "First board note",
      system: [],
      attached: false,
      next: { cursor: 1, notice: 0, messages: [], failed: false },
    }
    const first = BoardContext.inject(history, snapshot)
    expect(history).toEqual(before)
    expect(first).toEqual([{ role: "user", content: "First board note" }])
    expect(BoardContext.inject(history, { ...snapshot, text: "Updated board note" })).toEqual([
      { role: "user", content: "Updated board note" },
    ])
    expect(history).toEqual(before)
    const cache = BoardContext.cache()
    expect(BoardContext.inject([], snapshot)).toEqual([])
    BoardContext.accept(cache, snapshot, true)
    expect(cache.cursor).toBeUndefined()
    expect(BoardContext.inject(history, undefined)).toEqual([])
  })

  it.live("uses one fresh configuration snapshot and still observes permission changes", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const agents = yield* Agent.Service
          const config = yield* Config.Service
          const root = yield* sessions.create({ title: "Configuration snapshot" })
          const message = yield* seed(root.id, "Inspect the current configuration")
          yield* agents.get("code")
          const probe = spyOn(config, "get")
          yield* Effect.addFinalizer(() => Effect.sync(() => probe.mockRestore()))
          const input = { cache: BoardContext.cache(), session: root, agent, user: message.info, messages: [message] }
          expect(yield* BoardContext.prepare(input)).toBeDefined()
          expect(probe).toHaveBeenCalledTimes(1)
          yield* config.update({ permission: { board_read: "deny" } })
          expect(yield* BoardContext.prepare(input)).toBeUndefined()
        }),
      options,
    ),
  )

  it.live("delivers selectively and retains context without persisting receipt parts", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const root = yield* sessions.create({ title: "Board root" })
          const child = yield* sessions.create({ parentID: root.id, title: "Researcher" })
          const sibling = yield* sessions.create({ parentID: root.id, title: "Other researcher" })
          const message = yield* seed(root.id, "Implement cancellation support")
          const assignment = yield* seed(child.id, "Inspect cancellation propagation")
          const post = (to: string, type: BoardStore.Kind, body: string) =>
            BoardStore.post({
              sessionID: child.id,
              messageID: assignment.info.id,
              callID: body,
              to,
              type,
              body,
            })
          yield* post("main", "INFO", "DIRECT_FINDING")
          yield* post("ALL", "INFO", "BROADCAST_GUESS")
          yield* post("ALL", "HOLD", "ADVISORY_HOLD")
          yield* post(sibling.id, "INFO", "OTHER_RECIPIENT")
          yield* BoardStore.post({
            sessionID: root.id,
            messageID: message.info.id,
            callID: "own",
            to: "ALL",
            type: "VETO",
            body: "OWN_WARNING",
          })

          const cache = BoardContext.cache()
          const input = { cache, session: root, agent, user: message.info, messages: [message] }
          const first = yield* BoardContext.prepare(input)
          expect(first?.text).toContain("DIRECT_FINDING")
          expect(first?.text).toContain("ADVISORY_HOLD")
          expect(first?.text).toContain("New general broadcasts")
          expect(first?.text).not.toContain("BROADCAST_GUESS")
          expect(first?.text).not.toContain("OTHER_RECIPIENT")
          expect(first?.text).not.toContain("OWN_WARNING")
          expect(first?.system.join("\n")).toContain("Work independently by default")
          BoardContext.inject(input.messages, first)
          BoardContext.accept(cache, first, false)
          expect(cache.cursor).toBeUndefined()

          const fresh = yield* sessions.messages({ sessionID: root.id })
          expect(
            fresh
              .flatMap((item) => item.parts)
              .some((part) => part.type === "text" && part.metadata?.shared_agent_board === true),
          ).toBe(false)
          const retry = yield* BoardContext.prepare({ ...input, messages: fresh })
          expect(retry?.text).toBe(first?.text)
          const before = structuredClone(fresh)
          const tail = BoardContext.inject(fresh, retry)
          expect(BoardContext.inject(fresh, retry)).toEqual(tail)
          expect(tail).toEqual([{ role: "user", content: retry?.text ?? "" }])
          expect(fresh).toEqual(before)
          BoardContext.accept(cache, retry, true)
          expect(cache.cursor).toBeGreaterThan(0)

          const next = yield* sessions.messages({ sessionID: root.id })
          const retained = yield* BoardContext.prepare({ ...input, messages: next })
          expect(retained?.text).toContain("DIRECT_FINDING")
          expect(retained?.text).toContain("ADVISORY_HOLD")
          expect(retained?.text).not.toContain("New general broadcasts")
          expect(retained?.text).not.toContain("BROADCAST_GUESS")
          const history = yield* BoardStore.read({ sessionID: root.id })
          expect(history.messages.map((item) => item.body)).toContain("BROADCAST_GUESS")
          expect(history.messages.map((item) => item.body)).toContain("OTHER_RECIPIENT")
          expect(history.messages.map((item) => item.body)).toContain("OWN_WARNING")
          yield* sessions.setPermission({
            sessionID: root.id,
            permission: Permission.fromConfig({ board_read: "deny" }),
          })
          expect(yield* BoardContext.prepare({ ...input, messages: next })).toBeUndefined()
        }),
      options,
    ),
  )

  it.live("keeps participant cursors separate and restores notes after compaction or resume", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const root = yield* sessions.create({ title: "Shared objective" })
          const child = yield* sessions.create({ parentID: root.id, title: "Local work" })
          const main = yield* seed(root.id, "ROOT_OBJECTIVE")
          const local = yield* seed(child.id, "LOCAL_ASSIGNMENT")
          yield* BoardStore.post({
            sessionID: root.id,
            messageID: main.info.id,
            callID: "warning",
            to: "ALL",
            type: "VETO",
            body: "KEEP_SIGKILL_FALLBACK",
          })
          yield* BoardStore.post({
            sessionID: root.id,
            messageID: main.info.id,
            callID: "main-only",
            to: "main",
            type: "INFO",
            body: "MAIN_ONLY_NOTE",
          })
          const cache = BoardContext.cache()
          const input = { cache, session: child, agent, user: local.info, messages: [local] }
          const initial = yield* BoardContext.prepare(input)
          expect(initial?.text).toContain(child.id)
          expect(initial?.text).toContain('Parent participant: "main"')
          expect(initial?.text).toContain("ROOT_OBJECTIVE")
          expect(initial?.text).toContain("LOCAL_ASSIGNMENT")
          expect(initial?.text).toContain("KEEP_SIGKILL_FALLBACK")
          expect(initial?.text).not.toContain("MAIN_ONLY_NOTE")
          BoardContext.inject(input.messages, initial)
          BoardContext.accept(cache, initial, true)

          const continuation = user(child.id)
          const compacted: MessageV2.WithParts = { info: continuation, parts: [] }
          const projection = [compacted]
          const retained = yield* BoardContext.prepare({ ...input, user: continuation, messages: projection })
          expect(retained?.text).toContain("LOCAL_ASSIGNMENT")
          expect(retained?.text).toContain("KEEP_SIGKILL_FALLBACK")
          expect(BoardContext.inject(projection, retained)).toEqual([{ role: "user", content: retained?.text ?? "" }])
          expect(compacted.parts).toEqual([])

          const restored = yield* BoardContext.prepare({ ...input, cache: BoardContext.cache() })
          expect(restored?.text).toContain("KEEP_SIGKILL_FALLBACK")
          const sibling = yield* sessions.create({ parentID: root.id, title: "Late researcher" })
          const assignment = yield* seed(sibling.id, "NEW_RESEARCHER")
          const joined = yield* BoardContext.prepare({
            cache: BoardContext.cache(),
            session: sibling,
            agent,
            user: assignment.info,
            messages: [assignment],
          })
          expect(joined?.text).toContain("KEEP_SIGKILL_FALLBACK")
          expect(joined?.text).not.toContain("MAIN_ONLY_NOTE")
          expect(joined?.text).toContain("NEW_RESEARCHER")
          const parent = yield* BoardContext.prepare({
            cache: BoardContext.cache(),
            session: root,
            agent,
            user: main.info,
            messages: [main],
          })
          expect(parent?.text).not.toContain("KEEP_SIGKILL_FALLBACK")
        }),
      options,
    ),
  )

  it.live("restores the newest byte-bounded warnings on each fresh run", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const root = yield* sessions.create({ title: "Recent board warnings" })
          const child = yield* sessions.create({ parentID: root.id, title: "Researcher" })
          const message = yield* seed(root.id, "Objective ".repeat(500))
          const assignment = yield* seed(child.id, "Research")
          const posts = yield* Effect.forEach(
            Array.from({ length: 12 }, (_, index) => index),
            (index) =>
              BoardStore.post({
                sessionID: child.id,
                messageID: assignment.info.id,
                callID: `recent-${index}`,
                to: "main",
                type: "VETO",
                body: `Warning ${index}: ${"x".repeat(3200)}`,
              }),
          )
          for (let run = 0; run < 2; run++) {
            const cache = BoardContext.cache()
            const messages = [message]
            const snapshot = yield* BoardContext.prepare({ cache, session: root, agent, user: message.info, messages })
            expect(snapshot?.text).toContain("Warning 11:")
            expect(snapshot?.text).not.toContain("Warning 0:")
            expect(snapshot?.text).toContain("Additional notes remain available through board_read.")
            expect(Buffer.byteLength((snapshot?.text ?? "") + (snapshot?.system.join("\n") ?? ""))).toBeLessThanOrEqual(
              16 * 1024,
            )
            BoardContext.inject(messages, snapshot)
            BoardContext.accept(cache, snapshot, true)
            expect(cache.cursor).toBe(posts.length)
            expect(cache.messages.length).toBeGreaterThan(0)
            expect(cache.messages.length).toBeLessThan(posts.length)
            expect(cache.messages.map((post) => post.id)).toEqual(
              posts.slice(-cache.messages.length).map((post) => post.id),
            )
          }
        }),
      options,
    ),
  )

  it.live("bounds context and drains pending warnings without skipping a full batch", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const root = yield* sessions.create({ title: "Bounded board" })
          const child = yield* sessions.create({ parentID: root.id, title: "Researcher" })
          const message = yield* seed(root.id, "Objective ".repeat(500))
          const assignment = yield* seed(child.id, "Research")
          const cache = BoardContext.cache()
          const input = { cache, session: root, agent, user: message.info, messages: [message] }
          const initial = yield* BoardContext.prepare(input)
          BoardContext.inject(input.messages, initial)
          BoardContext.accept(cache, initial, true)
          expect(cache.cursor).toBe(0)
          const posts = yield* Effect.forEach(
            Array.from({ length: 12 }, (_, index) => index),
            (index) =>
              BoardStore.post({
                sessionID: child.id,
                messageID: assignment.info.id,
                callID: `large-${index}`,
                to: "main",
                type: "VETO",
                body: `Warning ${index}: ${"x".repeat(3200)}`,
              }),
          )
          const seen = new Set<string>()
          for (let step = 0; step < posts.length && seen.size < posts.length; step++) {
            const messages = yield* sessions.messages({ sessionID: root.id })
            const snapshot = yield* BoardContext.prepare({ ...input, messages })
            expect(snapshot?.text).not.toContain("Shared board access is unavailable")
            expect(Buffer.byteLength((snapshot?.text ?? "") + (snapshot?.system.join("\n") ?? ""))).toBeLessThanOrEqual(
              16 * 1024,
            )
            for (const post of posts) {
              if (snapshot?.text.includes(post.id)) seen.add(post.id)
            }
            BoardContext.inject(messages, snapshot)
            BoardContext.accept(cache, snapshot, true)
          }
          expect([...seen]).toEqual(posts.map((post) => post.id))
          const page = yield* BoardStore.read({ sessionID: root.id })
          expect(page.hasMore).toBe(true)
          expect(page.cursor).toBeDefined()
          const rest = yield* BoardStore.read({ sessionID: root.id, since: page.cursor })
          expect([...page.messages, ...rest.messages]).toHaveLength(posts.length)
        }),
      options,
    ),
  )

  it.live("does not inject anything when the experiment is disabled", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const root = yield* sessions.create({ title: "Disabled board" })
        const message = yield* seed(root.id, "Work independently")
        const cache = BoardContext.cache()
        expect(
          yield* BoardContext.prepare({ cache, session: root, agent, user: message.info, messages: [message] }),
        ).toBeUndefined()
        expect(cache.cursor).toBeUndefined()
        expect(cache.messages).toHaveLength(0)
      }),
    ),
  )

  test("automatic reads respect session denials, read-only ceilings, and tool toggles", () => {
    const id = SessionID.make("ses_board_permissions")
    const message = user(id)
    const input = { agent, session: { id }, user: message }
    expect(BoardContext.allowed(input)).toBe(true)
    expect(
      BoardContext.allowed({ ...input, session: { id, permission: Permission.fromConfig({ board_read: "deny" }) } }),
    ).toBe(false)
    expect(BoardContext.allowed({ ...input, user: { ...message, tools: { board_read: false } } })).toBe(false)
    expect(
      BoardContext.allowed({
        ...input,
        agent: { name: "code", permission: Permission.fromConfig({ board_read: "ask" }) },
      }),
    ).toBe(false)
    expect(
      BoardContext.allowed({
        ...input,
        agent: { name: "plan", permission: Permission.fromConfig({ board_read: "deny" }) },
        session: { id, permission: Permission.fromConfig({ board_read: "allow" }) },
      }),
    ).toBe(false)
  })
})
