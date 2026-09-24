import { $ } from "bun"
import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq, sql } from "drizzle-orm"
import { Session } from "@/session/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Git } from "@/git"
import { Project } from "@/project/project"
import { BoardStore } from "@/kilocode/board/store"
import { WorktreeUsage } from "@/kilocode/worktree/usage"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { TestInstance, provideInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

// WorktreeUsage transitively requires Git.Service/Project.Service through
// WorktreeFamily.list(), even on the non-git code path, so both nodes must be
// in the test layer alongside Session/SessionProjector/Database.
const it = testEffect(
  LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node, Git.node, Project.node])),
)

const ref = (providerID: string, modelID: string) => ({
  providerID: ProviderV2.ID.make(providerID),
  modelID: ModelV2.ID.make(modelID),
})

const seedAssistant = Effect.fn("WorktreeUsageTest.seedAssistant")(function* (input: {
  sessionID: SessionID
  agent?: string
  variant?: string
  model: ReturnType<typeof ref>
}) {
  const sessions = yield* Session.Service
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    agent: input.agent ?? "build",
    model: input.model,
    time: { created: Date.now() },
  })
  return yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: input.sessionID,
    mode: "build",
    agent: input.agent ?? "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: input.model.modelID,
    providerID: input.model.providerID,
    ...(input.variant ? { variant: input.variant } : {}),
    time: { created: Date.now() },
  } satisfies MessageV2.Assistant)
})

const step = Effect.fn("WorktreeUsageTest.step")(function* (input: {
  sessionID: SessionID
  messageID: MessageID
  model?: ReturnType<typeof ref>
  cost: number
  tokens: MessageV2.StepFinishPart["tokens"]
  time?: { start: number; end: number; elapsed: number }
}) {
  const sessions = yield* Session.Service
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: input.messageID,
    sessionID: input.sessionID,
    type: "step-finish",
    reason: "stop",
    model: input.model,
    cost: input.cost,
    tokens: input.tokens,
    ...(input.time ? { time: input.time } : {}),
  })
})

const startOf = (event: WorktreeUsage.TimelineEvent) => (event.kind === "generation" ? event.time.start : undefined)

type ToolStatus = "pending" | "running" | "completed" | "error"

const tool = Effect.fn("WorktreeUsageTest.tool")(function* (config: {
  sessionID: SessionID
  messageID: MessageID
  toolName: string
  toolInput?: Record<string, unknown>
  status?: ToolStatus
  time?: { start: number; end?: number }
  metadata?: Record<string, unknown>
}) {
  const sessions = yield* Session.Service
  const status = config.status ?? "completed"
  const toolInput = config.toolInput ?? {}
  const start = config.time?.start ?? Date.now()
  const end = config.time?.end
  const state =
    status === "pending"
      ? ({ status: "pending", input: toolInput, raw: "" } as const)
      : status === "running"
        ? ({ status: "running", input: toolInput, time: { start } } as const)
        : status === "error"
          ? ({ status: "error", input: toolInput, error: "boom", time: { start, end: end ?? start } } as const)
          : ({
              status: "completed",
              input: toolInput,
              output: "done",
              title: config.toolName,
              metadata: config.metadata ?? {},
              time: { start, end: end ?? start },
            } as const)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: config.messageID,
    sessionID: config.sessionID,
    type: "tool",
    callID: `call_${config.messageID}`,
    tool: config.toolName,
    state,
  } satisfies MessageV2.ToolPart)
})

describe("WorktreeUsage", () => {
  it.instance("aggregates direct and subtree usage across nested subagents without double counting", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const model = ref("openai", "gpt-5")

      const root = yield* sessions.create({ title: "root" })
      const child = yield* sessions.create({ title: "child", parentID: root.id })
      const grandchild = yield* sessions.create({ title: "grandchild", parentID: child.id })

      const rootMessage = yield* seedAssistant({ sessionID: root.id, model })
      yield* step({
        sessionID: root.id,
        messageID: rootMessage.id,
        cost: 1,
        tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const childMessage = yield* seedAssistant({ sessionID: child.id, model })
      yield* step({
        sessionID: child.id,
        messageID: childMessage.id,
        cost: 2,
        tokens: { input: 20, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const grandchildMessage = yield* seedAssistant({ sessionID: grandchild.id, model })
      yield* step({
        sessionID: grandchild.id,
        messageID: grandchildMessage.id,
        cost: 4,
        tokens: { input: 40, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const detail = yield* WorktreeUsage.get()
      expect(detail.worktree.rootSessions).toBe(1)
      expect(detail.worktree.sessions).toBe(3)
      expect(detail.worktree.subagents).toBe(2)
      expect(detail.worktree.totals.cost).toBe(7)

      const byID = new Map(detail.sessions.map((row) => [row.id, row]))
      expect(byID.get(root.id)?.direct.cost).toBe(1)
      expect(byID.get(root.id)?.subtree.cost).toBe(7)
      expect(byID.get(child.id)?.direct.cost).toBe(2)
      expect(byID.get(child.id)?.subtree.cost).toBe(6)
      expect(byID.get(grandchild.id)?.direct.cost).toBe(4)
      expect(byID.get(grandchild.id)?.subtree.cost).toBe(4)

      // Sum of model-group cost must equal the worktree total: no propagated
      // Session.cost double-counting, only real step-finish rows.
      const modelTotal = detail.models.reduce((sum, group) => sum + group.cost, 0)
      expect(modelTotal).toBe(7)
    }),
  )

  it.instance("groups usage by model/variant and by agent without merging distinct variants", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      const model = ref("kilo", "kilo-auto/efficient")

      const plain = yield* seedAssistant({ sessionID: root.id, model, agent: "build" })
      yield* step({
        sessionID: root.id,
        messageID: plain.id,
        cost: 1,
        tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const highVariant = yield* seedAssistant({ sessionID: root.id, model, agent: "build", variant: "high" })
      yield* step({
        sessionID: root.id,
        messageID: highVariant.id,
        cost: 3,
        tokens: { input: 30, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const explore = yield* seedAssistant({ sessionID: root.id, model, agent: "explore" })
      yield* step({
        sessionID: root.id,
        messageID: explore.id,
        cost: 5,
        tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const detail = yield* WorktreeUsage.get()
      expect(detail.models).toHaveLength(2)
      const noVariant = detail.models.find((group) => group.variant === undefined)
      const variant = detail.models.find((group) => group.variant === "high")
      expect(noVariant?.cost).toBe(6) // plain (1) + explore (5), same model/no variant
      expect(variant?.cost).toBe(3)

      expect(detail.agents).toHaveLength(2)
      const build = detail.agents.find((group) => group.agent === "build")
      const exploreAgent = detail.agents.find((group) => group.agent === "explore")
      expect(build?.cost).toBe(4)
      expect(exploreAgent?.cost).toBe(5)
    }),
  )

  it.instance("unions overlapping active intervals and tracks coverage for legacy/in-flight rows", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      const model = ref("test", "model")
      const base = 1_700_000_000_000

      // Two overlapping 1000ms generations: union should be 1500ms, not 2000ms.
      const first = yield* seedAssistant({ sessionID: root.id, model })
      yield* step({
        sessionID: root.id,
        messageID: first.id,
        cost: 1,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { start: base, end: base + 1000, elapsed: 1000 },
      })
      const second = yield* seedAssistant({ sessionID: root.id, model })
      yield* step({
        sessionID: root.id,
        messageID: second.id,
        cost: 1,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { start: base + 500, end: base + 1500, elapsed: 1000 },
      })
      // A legacy step-finish with no `time` field: contributes cost/tokens but
      // not modelMs, and lowers the timed/total step coverage ratio.
      const legacy = yield* seedAssistant({ sessionID: root.id, model })
      yield* step({
        sessionID: root.id,
        messageID: legacy.id,
        cost: 1,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      // A still-running tool has no end and must not crash aggregation.
      yield* tool({ sessionID: root.id, messageID: legacy.id, toolName: "bash", status: "running" })

      const detail = yield* WorktreeUsage.get()
      expect(detail.worktree.time.activeMs).toBe(1500)
      expect(detail.worktree.time.coverage.timedSteps).toBe(2)
      expect(detail.worktree.time.coverage.totalSteps).toBe(3)
      expect(detail.worktree.time.coverage.totalTools).toBe(1)
      expect(detail.worktree.time.coverage.closedTools).toBe(0)
    }),
  )

  it.instance(
    "classifies task/board/agent-manager tool calls into typed events without content, falling back to generic tool events otherwise",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const root = yield* sessions.create({ title: "root" })
        const child = yield* sessions.create({ title: "child", parentID: root.id })
        const other = yield* sessions.create({ title: "other" })
        const user = yield* seedAssistant({ sessionID: root.id, model: ref("test", "model") })

        yield* tool({
          sessionID: root.id,
          messageID: user.id,
          toolName: "task",
          toolInput: { subagent_type: "explore", description: "look around" },
          metadata: { parentSessionId: root.id, sessionId: child.id },
        })
        yield* tool({ sessionID: root.id, messageID: user.id, toolName: "board_read" })
        yield* tool({
          sessionID: root.id,
          messageID: user.id,
          toolName: "agent_manager",
          toolInput: { action: "prompt", sessionID: other.id, prompt: "do the thing" },
          metadata: { action: "prompt", sessionID: other.id },
        })
        yield* tool({
          sessionID: root.id,
          messageID: user.id,
          toolName: "agent_manager",
          toolInput: { action: "prompt", sessionID: other.id, prompt: "reply text", replyTo: "req_1" },
          metadata: { action: "prompt", sessionID: other.id, replyTo: "req_1" },
        })
        yield* tool({ sessionID: root.id, messageID: user.id, toolName: "bash", toolInput: { command: "ls" } })
        yield* BoardStore.post({ sessionID: root.id, messageID: user.id, to: "ALL", type: "INFO", body: "status update" })

        const detail = yield* WorktreeUsage.get()
        expect(detail.worktree.communication).toEqual({
          boardPosts: 1,
          boardReads: 1,
          agentManagerPrompts: 1,
          agentManagerReplies: 1,
          boardBytes: "status update".length,
          directCost: 0,
        })

        const timeline = yield* WorktreeUsage.timeline({ limit: 50 })
        const byKind = <K extends WorktreeUsage.TimelineEvent["kind"]>(kind: K) =>
          timeline.events.filter((event): event is Extract<WorktreeUsage.TimelineEvent, { kind: K }> => event.kind === kind)

        expect(byKind("subagent")).toHaveLength(1)
        expect(byKind("subagent")[0].childSessionID).toBe(child.id)
        expect(byKind("tool")).toHaveLength(1)
        expect(byKind("tool")[0].tool).toBe("bash")

        const comms = byKind("communication")
        expect(comms).toHaveLength(4)
        expect(comms.filter((event) => event.channel === "board" && event.action === "post")).toHaveLength(1)
        expect(comms.filter((event) => event.channel === "board" && event.action === "read")).toHaveLength(1)
        expect(comms.filter((event) => event.channel === "agent_manager" && event.action === "prompt")).toHaveLength(1)
        expect(comms.filter((event) => event.channel === "agent_manager" && event.action === "reply")).toHaveLength(1)

        // Content-free: no communication or tool event carries prompt/body/output text.
        for (const event of timeline.events) {
          const json = JSON.stringify(event)
          expect(json).not.toContain("do the thing")
          expect(json).not.toContain("reply text")
          expect(json).not.toContain("status update")
          expect(json).not.toContain("\"output\"")
          expect(json).not.toContain("\"body\"")
        }
      }),
  )

  it.instance("paginates the timeline newest-first with a stable cursor and rejects a malformed cursor", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      const model = ref("test", "model")
      const base = 1_700_000_000_000

      for (const [index, start] of [base, base + 1000, base + 2000].entries()) {
        const message = yield* seedAssistant({ sessionID: root.id, model })
        yield* step({
          sessionID: root.id,
          messageID: message.id,
          cost: index + 1,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { start, end: start + 10, elapsed: 10 },
        })
      }

      const page1 = yield* WorktreeUsage.timeline({ limit: 2 })
      expect(page1.hasMore).toBe(true)
      expect(page1.cursor).toBeDefined()
      expect(page1.events.map(startOf)).toEqual([base + 2000, base + 1000])

      const page2 = yield* WorktreeUsage.timeline({ limit: 2, before: page1.cursor })
      expect(page2.hasMore).toBe(false)
      expect(page2.events.map(startOf)).toEqual([base])

      const err = yield* WorktreeUsage.timeline({ limit: 2, before: "not-a-real-cursor" }).pipe(Effect.flip)
      expect(WorktreeUsage.InvalidCursorError.isInstance(err)).toBe(true)
    }),
  )

  it.instance("clamps malformed JSON and negative numeric step values instead of corrupting totals", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { db } = yield* Database.Service
      const root = yield* sessions.create({ title: "root" })
      const message = yield* seedAssistant({ sessionID: root.id, model: ref("test", "model") })

      // Negative cost/tokens must clamp to zero rather than going negative or NaN.
      yield* step({
        sessionID: root.id,
        messageID: message.id,
        cost: -5,
        tokens: { input: -1, output: -1, reasoning: -1, cache: { read: -1, write: -1 } },
      })
      // A malformed (invalid JSON) part row must not crash aggregation.
      yield* db.run(sql`
        INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES (${PartID.ascending()}, ${message.id}, ${root.id}, 1, 1, '{not valid json')
      `)

      const detail = yield* WorktreeUsage.get()
      expect(detail.worktree.totals.cost).toBe(0)
      expect(detail.worktree.totals.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })
      expect(Number.isFinite(detail.worktree.totals.cost)).toBe(true)
    }),
  )

  it.instance(
    "reports primary and linked worktree kinds with isolated per-worktree totals",
    () =>
      Effect.gen(function* () {
        const primary = yield* TestInstance
        const linked = path.join(primary.directory, ".kilo", "worktrees", "task-a")
        yield* Effect.promise(() => $`git worktree add ${linked} -b task-a`.cwd(primary.directory).quiet())

        const sessions = yield* Session.Service
        const model = ref("test", "model")
        const primaryRoot = yield* sessions.create({ title: "primary root" })
        const primaryMessage = yield* seedAssistant({ sessionID: primaryRoot.id, model })
        yield* step({
          sessionID: primaryRoot.id,
          messageID: primaryMessage.id,
          cost: 1,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        yield* Effect.gen(function* () {
          const linkedSessions = yield* Session.Service
          const linkedRoot = yield* linkedSessions.create({ title: "linked root" })
          const linkedMessage = yield* seedAssistant({ sessionID: linkedRoot.id, model })
          yield* step({
            sessionID: linkedRoot.id,
            messageID: linkedMessage.id,
            cost: 2,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          })
        }).pipe(provideInstance(linked))

        const summaries = yield* WorktreeUsage.summaries()
        expect(summaries.worktrees).toHaveLength(2)
        const primaryEntry = summaries.worktrees.find((entry) => entry.directory === primary.directory)
        const linkedEntry = summaries.worktrees.find((entry) => entry.directory === linked)
        expect(primaryEntry?.kind).toBe("primary")
        expect(primaryEntry?.totals.cost).toBe(1)
        expect(linkedEntry?.kind).toBe("linked")
        expect(linkedEntry?.totals.cost).toBe(2)
      }),
    { git: true },
  )

  it.instance(
    "reassigns a whole subtree's economics when its root session's directory moves worktrees",
    () =>
      Effect.gen(function* () {
        const primary = yield* TestInstance
        const linked = path.join(primary.directory, ".kilo", "worktrees", "task-b")
        yield* Effect.promise(() => $`git worktree add ${linked} -b task-b`.cwd(primary.directory).quiet())

        const sessions = yield* Session.Service
        const model = ref("test", "model")
        const root = yield* sessions.create({ title: "root" })
        const child = yield* sessions.create({ title: "child", parentID: root.id })
        const rootMessage = yield* seedAssistant({ sessionID: root.id, model })
        yield* step({
          sessionID: root.id,
          messageID: rootMessage.id,
          cost: 1,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        const childMessage = yield* seedAssistant({ sessionID: child.id, model })
        yield* step({
          sessionID: child.id,
          messageID: childMessage.id,
          cost: 3,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        // Only the root's directory moves; the child keeps its original directory
        // to prove ownership follows the root, not each descendant's own row.
        const { db } = yield* Database.Service
        yield* db.update(SessionTable).set({ directory: linked }).where(eq(SessionTable.id, root.id))

        const afterMove = yield* WorktreeUsage.get().pipe(provideInstance(linked))
        expect(afterMove.worktree.sessions).toBe(2)
        expect(afterMove.worktree.totals.cost).toBe(4)

        const primaryAfterMove = yield* WorktreeUsage.get()
        expect(primaryAfterMove.worktree.sessions).toBe(0)
        expect(primaryAfterMove.worktree.totals.cost).toBe(0)
      }),
    { git: true },
  )
})
