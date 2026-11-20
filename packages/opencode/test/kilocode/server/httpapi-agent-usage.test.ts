import { afterEach, describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { disposeAllInstances, TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { httpApiLayer, requestInDirectory } from "../../server/httpapi-layer"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node])),
    httpApiLayer,
  ).pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          KILO_SERVER_PASSWORD: "",
          KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
        }),
      ),
    ),
  ),
)

const tokens = (input: number) => ({ input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

type TurnInput = {
  sessionID: SessionID
  agent: string
  created: number
  cost: number
}

const turn = Effect.fn("AgentUsageHttpTest.turn")(function* (input: TurnInput) {
  const sessions = yield* Session.Service
  const parent = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    agent: input.agent,
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
    time: { created: input.created },
  } satisfies MessageV2.User)
  const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") }
  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: parent.id,
    sessionID: input.sessionID,
    mode: input.agent,
    agent: input.agent,
    cost: input.cost,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: tokens(0),
    modelID: model.modelID,
    providerID: model.providerID,
    time: { created: input.created, completed: input.created + 100 },
  } satisfies MessageV2.Assistant)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: input.sessionID,
    type: "step-finish",
    reason: "stop",
    model,
    cost: input.cost,
    tokens: tokens(10),
  } satisfies MessageV2.StepFinishPart)
})

type Page = { items: { id: string; agent: string; startedAt: number }[]; next?: string }

const page = (body: unknown): Page => {
  if (!body || typeof body !== "object" || !("items" in body) || !Array.isArray(body.items))
    throw new Error(`expected a run page, got ${JSON.stringify(body)}`)
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- narrow through the runtime guard above
  return body as Page
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("agent usage HTTP routes", () => {
  it.instance("returns one summary row per agent with the AC1 rollup fields", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      yield* turn({ sessionID: root.id, agent: "build", created: 1_000, cost: 0.25 })
      yield* turn({ sessionID: root.id, agent: "build", created: 2_000, cost: 0.25 })
      yield* turn({ sessionID: root.id, agent: "plan", created: 3_000, cost: 0.5 })

      const response = yield* requestInDirectory("/kilocode/agent-usage/summary", test.directory)
      const body = yield* response.json
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(body).toEqual([
        {
          agent: "build",
          runs: 2,
          sessions: 1,
          cost: 0.5,
          activeMs: 200,
          tokens: tokens(20),
          errors: 0,
          lastRunAt: 2_000,
        },
        {
          agent: "plan",
          runs: 1,
          sessions: 1,
          cost: 0.5,
          activeMs: 100,
          tokens: tokens(10),
          errors: 0,
          lastRunAt: 3_000,
        },
      ])
    }),
  )

  it.instance("pages every run exactly once while new runs arrive between pages", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      for (const created of [1_000, 2_000, 3_000, 4_000, 5_000]) {
        yield* turn({ sessionID: root.id, agent: "build", created, cost: 0.25 })
      }
      const baseline = yield* requestInDirectory("/kilocode/agent-usage/runs?limit=100", test.directory)
      const all = page(yield* baseline.json).items.map((run) => run.id)
      expect(all).toHaveLength(5)

      const seen: string[] = []
      const first = yield* requestInDirectory("/kilocode/agent-usage/runs?limit=2", test.directory)
      const page1 = page(yield* first.json)
      expect(page1.items.map((run) => run.startedAt)).toEqual([5_000, 4_000])
      expect(page1.next).toBeString()
      seen.push(...page1.items.map((run) => run.id))

      // A new run inserted after the first page must not shift or duplicate the remaining pages.
      yield* turn({ sessionID: root.id, agent: "build", created: 6_000, cost: 0.25 })

      const second = yield* requestInDirectory(
        `/kilocode/agent-usage/runs?limit=2&cursor=${page1.next}`,
        test.directory,
      )
      const page2 = page(yield* second.json)
      seen.push(...page2.items.map((run) => run.id))
      const third = yield* requestInDirectory(`/kilocode/agent-usage/runs?limit=2&cursor=${page2.next}`, test.directory)
      const page3 = page(yield* third.json)
      seen.push(...page3.items.map((run) => run.id))
      expect(page3.next).toBeUndefined()

      expect(seen).toEqual(all)
      expect(new Set(seen).size).toBe(seen.length)
    }),
  )

  it.instance("returns an empty page for an unknown agent and rejects a malformed cursor", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "root" })
      yield* turn({ sessionID: root.id, agent: "build", created: 1_000, cost: 0.25 })

      const unknown = yield* requestInDirectory("/kilocode/agent-usage/runs?agent=missing", test.directory)
      expect(unknown.status).toBe(200)
      expect(yield* unknown.json).toEqual({ items: [] })

      const malformed = yield* requestInDirectory("/kilocode/agent-usage/runs?cursor=not-a-cursor", test.directory)
      const body = yield* malformed.json
      expect(malformed.status, JSON.stringify(body)).toBe(400)
      expect(body).toMatchObject({ _tag: "InvalidRequestError", field: "cursor" })
    }),
  )

  it.instance("enforces the limit bounds at the schema edge", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      for (const limit of ["0", "101", "-1"]) {
        const response = yield* requestInDirectory(`/kilocode/agent-usage/runs?limit=${limit}`, test.directory)
        expect(response.status, `limit=${limit}`).toBe(400)
      }
      const low = yield* requestInDirectory("/kilocode/agent-usage/runs?limit=1", test.directory)
      expect(low.status).toBe(200)
    }),
  )
})
