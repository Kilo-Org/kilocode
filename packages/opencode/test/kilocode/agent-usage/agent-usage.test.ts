import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AgentUsage } from "@/kilocode/agent-usage"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Database } from "@opencode-ai/core/database/database"
import { sql } from "drizzle-orm"
import { testEffect } from "../../lib/effect"
import { TestInstance } from "../../fixture/fixture"

const it = testEffect(LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node])))

const ref = (providerID: string, modelID: string) => ({
  providerID: ProviderV2.ID.make(providerID),
  modelID: ModelV2.ID.make(modelID),
})

const tokens = (input: number, output: number, reasoning: number, read: number, write: number) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
})

const user = Effect.fn("AgentUsageTest.user")(function* (input: {
  sessionID: SessionID
  agent: string
  created: number
  model?: ReturnType<typeof ref>
}) {
  const sessions = yield* Session.Service
  return yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    agent: input.agent,
    model: input.model ?? ref("test", "model"),
    time: { created: input.created },
  } satisfies MessageV2.User)
})

type StepInput = {
  sessionID: SessionID
  parentID: MessageID
  agent: string
  created: number
  completed?: number
  cost: number
  tokens: MessageV2.StepFinishPart["tokens"]
  error?: MessageV2.Assistant["error"]
  model?: ReturnType<typeof ref>
  /** Propagated cost written onto the assistant message; never used for direct cost. */
  messageCost?: number
}

type TurnInput = Omit<StepInput, "parentID">

const step = Effect.fn("AgentUsageTest.step")(function* (input: StepInput) {
  const sessions = yield* Session.Service
  const model = input.model ?? ref("test", "model")
  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: input.parentID,
    sessionID: input.sessionID,
    mode: input.agent,
    agent: input.agent,
    cost: input.messageCost ?? input.cost,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: tokens(0, 0, 0, 0, 0),
    modelID: model.modelID,
    providerID: model.providerID,
    time: { created: input.created, ...(input.completed !== undefined ? { completed: input.completed } : {}) },
    ...(input.error !== undefined ? { error: input.error } : {}),
  } satisfies MessageV2.Assistant)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: input.sessionID,
    type: "step-finish",
    reason: "stop",
    model,
    cost: input.cost,
    tokens: input.tokens,
  } satisfies MessageV2.StepFinishPart)
  return assistant
})

const turn = Effect.fn("AgentUsageTest.turn")(function* (input: TurnInput) {
  const parent = yield* user({ sessionID: input.sessionID, agent: input.agent, created: input.created })
  return yield* step({ ...input, parentID: parent.id })
})

describe("agent usage", () => {
  it.instance("aggregates per-run and per-agent usage across sessions and agents", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      const child = yield* sessions.create({ title: "child", parentID: root.id })

      yield* turn({
        sessionID: root.id,
        agent: "build",
        created: 1_000,
        completed: 1_300,
        cost: 0.25,
        tokens: tokens(100, 20, 5, 200, 10),
      })
      yield* turn({
        sessionID: root.id,
        agent: "plan",
        created: 2_000,
        completed: 2_100,
        cost: 0.5,
        tokens: tokens(50, 10, 0, 100, 5),
      })
      yield* turn({
        sessionID: child.id,
        agent: "explore",
        created: 3_000,
        completed: 3_200,
        cost: 0.125,
        tokens: tokens(200, 40, 15, 400, 30),
      })

      const runs = yield* AgentUsage.runs()
      expect(runs.map((run) => run.agent)).toEqual(["explore", "plan", "build"])
      expect(runs.map((run) => run.startedAt)).toEqual([3_000, 2_000, 1_000])
      expect(runs).toEqual([
        {
          id: expect.any(String),
          agent: "explore",
          sessionID: child.id,
          rootSessionID: root.id,
          parentSessionID: root.id,
          title: "child",
          role: "explore",
          model: ref("test", "model"),
          startedAt: 3_000,
          completedAt: 3_200,
          activeMs: 200,
          cost: 0.125,
          tokens: tokens(200, 40, 15, 400, 30),
          outcome: "completed",
        },
        {
          id: expect.any(String),
          agent: "plan",
          sessionID: root.id,
          rootSessionID: root.id,
          parentSessionID: null,
          title: "root",
          role: "plan",
          model: ref("test", "model"),
          startedAt: 2_000,
          completedAt: 2_100,
          activeMs: 100,
          cost: 0.5,
          tokens: tokens(50, 10, 0, 100, 5),
          outcome: "completed",
        },
        {
          id: expect.any(String),
          agent: "build",
          sessionID: root.id,
          rootSessionID: root.id,
          parentSessionID: null,
          title: "root",
          role: "build",
          model: ref("test", "model"),
          startedAt: 1_000,
          completedAt: 1_300,
          activeMs: 300,
          cost: 0.25,
          tokens: tokens(100, 20, 5, 200, 10),
          outcome: "completed",
        },
      ])

      expect(yield* AgentUsage.summary()).toEqual([
        {
          agent: "build",
          runs: 1,
          sessions: 1,
          cost: 0.25,
          activeMs: 300,
          tokens: tokens(100, 20, 5, 200, 10),
          errors: 0,
          lastRunAt: 1_000,
        },
        {
          agent: "explore",
          runs: 1,
          sessions: 1,
          cost: 0.125,
          activeMs: 200,
          tokens: tokens(200, 40, 15, 400, 30),
          errors: 0,
          lastRunAt: 3_000,
        },
        {
          agent: "plan",
          runs: 1,
          sessions: 1,
          cost: 0.5,
          activeMs: 100,
          tokens: tokens(50, 10, 0, 100, 5),
          errors: 0,
          lastRunAt: 2_000,
        },
      ])
    }),
  )

  it.instance("sums multiple steps of one turn into a single run", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      const anchor = yield* user({ sessionID: root.id, agent: "build", created: 1_000 })
      yield* step({
        sessionID: root.id,
        parentID: anchor.id,
        agent: "build",
        created: 1_000,
        completed: 1_100,
        cost: 0.25,
        tokens: tokens(10, 2, 1, 4, 3),
      })
      yield* step({
        sessionID: root.id,
        parentID: anchor.id,
        agent: "build",
        created: 1_200,
        completed: 1_250,
        cost: 0.125,
        tokens: tokens(5, 1, 0, 2, 1),
      })

      const runs = yield* AgentUsage.runs()
      expect(runs).toHaveLength(1)
      expect(runs[0]!.id).toBe((yield* AgentUsage.runs())[0]!.id)
      expect(runs[0]).toMatchObject({
        agent: "build",
        startedAt: 1_000,
        completedAt: 1_250,
        activeMs: 150,
        cost: 0.375,
        tokens: tokens(15, 3, 1, 6, 4),
        outcome: "completed",
      })
    }),
  )

  it.instance("reports only direct step cost when the parent message carries propagated subagent cost", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      yield* turn({
        sessionID: root.id,
        agent: "build",
        created: 1_000,
        completed: 1_100,
        cost: 0.25,
        messageCost: 9.75,
        tokens: tokens(10, 2, 1, 4, 3),
      })

      const runs = yield* AgentUsage.runs()
      expect(runs[0]!.cost).toBe(0.25)
      expect((yield* AgentUsage.summary())[0]!.cost).toBe(0.25)
    }),
  )

  it.instance("excludes idle gaps between turns and incomplete messages from activeMs", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      yield* turn({
        sessionID: root.id,
        agent: "build",
        created: 1_000,
        completed: 1_100,
        cost: 0.25,
        tokens: tokens(10, 2, 1, 4, 3),
      })
      // A long idle gap, then a second turn of only 50ms of real work.
      yield* turn({
        sessionID: root.id,
        agent: "build",
        created: 900_000,
        completed: 900_050,
        cost: 0.25,
        tokens: tokens(10, 2, 1, 4, 3),
      })
      // A running turn has no completion time and contributes no active time.
      yield* turn({
        sessionID: root.id,
        agent: "build",
        created: 901_000,
        cost: 0.25,
        tokens: tokens(10, 2, 1, 4, 3),
      })

      const runs = yield* AgentUsage.runs()
      expect(runs.map((run) => run.activeMs)).toEqual([0, 50, 100])
      expect(runs.map((run) => run.outcome)).toEqual(["running", "completed", "completed"])
      expect((yield* AgentUsage.summary())[0]!.activeMs).toBe(150)
    }),
  )

  it.instance("derives the outcome from the run's last assistant message", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      const aborted = new MessageV2.AbortedError({ message: "aborted" }).toObject()
      const failed = new MessageV2.APIError({ message: "boom", isRetryable: false }).toObject()

      yield* turn({
        sessionID: root.id,
        agent: "completed",
        created: 1_000,
        completed: 1_100,
        cost: 0.25,
        tokens: tokens(1, 1, 0, 0, 0),
      })
      yield* turn({
        sessionID: root.id,
        agent: "cancelled",
        created: 2_000,
        completed: 2_100,
        error: aborted,
        cost: 0.25,
        tokens: tokens(1, 1, 0, 0, 0),
      })
      yield* turn({
        sessionID: root.id,
        agent: "errored",
        created: 3_000,
        completed: 3_100,
        error: failed,
        cost: 0.25,
        tokens: tokens(1, 1, 0, 0, 0),
      })
      yield* turn({
        sessionID: root.id,
        agent: "running",
        created: 4_000,
        cost: 0.25,
        tokens: tokens(1, 1, 0, 0, 0),
      })
      // Imported or partially written rows can carry an error without a
      // completion time; the error must win over `running`.
      yield* turn({
        sessionID: root.id,
        agent: "errored-incomplete",
        created: 5_000,
        error: failed,
        cost: 0.25,
        tokens: tokens(1, 1, 0, 0, 0),
      })

      const runs = yield* AgentUsage.runs()
      expect(Object.fromEntries(runs.map((run) => [run.agent, run.outcome]))).toEqual({
        completed: "completed",
        cancelled: "cancelled",
        errored: "errored",
        "errored-incomplete": "errored",
        running: "running",
      })

      const summary = yield* AgentUsage.summary()
      expect(Object.fromEntries(summary.map((row) => [row.agent, row.errors]))).toEqual({
        cancelled: 0,
        completed: 0,
        errored: 1,
        "errored-incomplete": 1,
        running: 0,
      })
    }),
  )

  it.instance("attributes each turn to the agent that produced it and filters by agent and window", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      yield* turn({
        sessionID: root.id,
        agent: "build",
        created: 1_000,
        completed: 1_100,
        cost: 0.25,
        tokens: tokens(1, 1, 0, 0, 0),
      })
      yield* turn({
        sessionID: root.id,
        agent: "plan",
        created: 2_000,
        completed: 2_100,
        cost: 0.5,
        tokens: tokens(1, 1, 0, 0, 0),
      })
      yield* turn({
        sessionID: root.id,
        agent: "build",
        created: 3_000,
        completed: 3_100,
        cost: 0.125,
        tokens: tokens(1, 1, 0, 0, 0),
      })

      const build = yield* AgentUsage.runs({ agent: "build" })
      expect(build.map((run) => run.agent)).toEqual(["build", "build"])
      expect(build.map((run) => run.startedAt)).toEqual([3_000, 1_000])

      const windowed = yield* AgentUsage.runs({ from: 1_500, to: 2_500 })
      expect(windowed.map((run) => run.agent)).toEqual(["plan"])

      const summary = yield* AgentUsage.summary({ agent: "build" })
      expect(summary).toEqual([
        {
          agent: "build",
          runs: 2,
          sessions: 1,
          cost: 0.375,
          activeMs: 200,
          tokens: tokens(2, 2, 0, 0, 0),
          errors: 0,
          lastRunAt: 3_000,
        },
      ])

      expect(yield* AgentUsage.runs({ agent: "missing" })).toEqual([])
    }),
  )

  it.instance("pages runs by keyset over startedAt and id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      for (const created of [1_000, 2_000, 3_000, 4_000]) {
        yield* turn({
          sessionID: root.id,
          agent: "build",
          created,
          completed: created + 100,
          cost: 0.25,
          tokens: tokens(1, 1, 0, 0, 0),
        })
      }
      // Two turns that start at the same millisecond must still page one by one.
      yield* turn({
        sessionID: root.id,
        agent: "plan",
        created: 5_000,
        completed: 5_100,
        cost: 0.5,
        tokens: tokens(1, 1, 0, 0, 0),
      })
      yield* turn({
        sessionID: root.id,
        agent: "plan",
        created: 5_000,
        completed: 5_100,
        cost: 0.5,
        tokens: tokens(1, 1, 0, 0, 0),
      })

      const all = yield* AgentUsage.runs()
      expect(all.map((run) => run.startedAt)).toEqual([5_000, 5_000, 4_000, 3_000, 2_000, 1_000])

      const first = yield* AgentUsage.runs({ limit: 2 })
      expect(first.map((run) => run.id)).toEqual(all.slice(0, 2).map((run) => run.id))

      const rest = yield* AgentUsage.runs({ limit: 2, cursor: first[1]! })
      expect(rest.map((run) => run.id)).toEqual(all.slice(2, 4).map((run) => run.id))

      const paged: string[] = first.map((run) => run.id)
      const limit = 2
      const second = yield* AgentUsage.runs({ limit, cursor: first.at(-1)! })
      paged.push(...second.map((run) => run.id))
      const third = yield* AgentUsage.runs({ limit, cursor: second.at(-1)! })
      paged.push(...third.map((run) => run.id))
      expect(paged).toEqual(all.map((run) => run.id))

      expect(yield* AgentUsage.runs({ limit: 2, cursor: all.at(-1)! })).toEqual([])
    }),
  )

  it.instance("keeps summary at one rollup per agent regardless of paging", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      for (const created of [1_000, 2_000, 3_000]) {
        yield* turn({
          sessionID: root.id,
          agent: "build",
          created,
          completed: created + 100,
          cost: 0.25,
          tokens: tokens(1, 1, 0, 0, 0),
        })
      }

      const summary = yield* AgentUsage.summary({ limit: 1, cursor: { startedAt: 2_000, id: MessageID.ascending() } })
      expect(summary).toHaveLength(1)
      expect(summary[0]).toMatchObject({ agent: "build", runs: 3, cost: 0.75, lastRunAt: 3_000 })
    }),
  )

  it.instance("round-trips the opaque cursor and rejects malformed input", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      yield* turn({
        sessionID: root.id,
        agent: "build",
        created: 1_000,
        completed: 1_100,
        cost: 0.25,
        tokens: tokens(1, 1, 0, 0, 0),
      })
      const [run] = yield* AgentUsage.runs()
      const encoded = AgentUsage.cursor.encode(run)
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
      // Passing a whole run must still yield a token that carries only the paging key.
      expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toEqual({
        startedAt: 1_000,
        id: run.id,
      })
      expect(AgentUsage.cursor.decode(encoded)).toEqual({ startedAt: 1_000, id: run.id })
      expect(() => AgentUsage.cursor.decode("not-a-cursor")).toThrow()
      expect(() =>
        AgentUsage.cursor.decode(Buffer.from(JSON.stringify({ startedAt: -1, id: run.id })).toString("base64url")),
      ).toThrow()
    }),
  )

  it.instance("drives the runs query off the session, message, and step-finish indexes", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const test = yield* TestInstance
      const projectID = ProjectV2.ID.make("plan-project")
      const plan = yield* db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${AgentUsage.runsQuery(projectID)}`)
      const details = plan.map((row) => row.detail).join("\n")
      expect(details).toContain("USING INDEX session_project_idx")
      expect(details).toContain("USING INDEX message_session_time_created_id_idx")
      expect(details).toContain("USING INDEX part_session_step_finish_idx")
      expect(details).not.toContain("SCAN part")
      expect(test.directory).toContain("opencode-test-")
    }),
  )
})
