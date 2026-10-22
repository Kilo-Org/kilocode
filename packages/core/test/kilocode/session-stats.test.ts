import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { AbsolutePath } from "@opencode/core/schema"
import { Database } from "@opencode/core/database/database"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStats } from "@opencode/core/session/stats"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { DateTime, Effect, Schema } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Database.node))

it.effect("groups each Kilo step by its own route and leaves requested models intact", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const projectID = Project.ID.make("stats-routed-project")
    const sessionID = Session.ID.make("ses_stats_routed")
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/stats-route"), name: "route", sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({ id: sessionID, project_id: projectID, slug: "route", directory: "/stats-route", version: "test" })
      .run()
      .pipe(Effect.orDie)
    const messages = [
      { providerID: "kilo", id: "kilo-auto/free", route: "openai/gpt-5.5", cost: 0.1 },
      { providerID: "kilo", id: "kilo-auto/free", route: "anthropic/claude-sonnet-4.6", cost: 0.2 },
      { providerID: "kilo", id: "kilo-auto/free", route: "openai/gpt-5.5", cost: 0 },
      { providerID: "kilo", id: "kilo-auto/free", route: undefined, cost: 0.3 },
      { providerID: "kilo", id: "kilo-auto/free", route: "  ", cost: 0 },
      { providerID: "kilo", id: "kilo-auto/free", route: 42, cost: 0 },
      { providerID: "anthropic", id: "claude-sonnet-4.6", route: "openai/gpt-5.5", cost: 0.4 },
    ].map((item, index) => {
      const encoded = Schema.encodeSync(SessionMessage.Assistant)(
        SessionMessage.Assistant.make({
          id: SessionMessage.ID.make(`msg_stats_route_${index}`),
          type: "assistant",
          agent: Agent.ID.make("build"),
          model: {
            providerID: Provider.ID.make(item.providerID),
            id: Model.ID.make(item.id),
            variant: Model.VariantID.make("high"),
          },
          native:
            item.route === undefined
              ? { routedModelID: "ignored-flat-route" }
              : { kilo: { routedModelID: item.route, vercelID: `request-${index}` } },
          content: [],
          cost: Money.USD.make(item.cost),
          tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 4, write: 1 } },
          time: { created: DateTime.makeUnsafe(1_000 + index) },
        }),
      )
      const { id, type, ...data } = encoded
      return {
        id: SessionMessage.ID.make(id),
        session_id: sessionID,
        type,
        seq: index + 1,
        time_created: 1_000 + index,
        data,
      }
    })
    yield* db.insert(SessionMessageTable).values(messages).run().pipe(Effect.orDie)

    const stats = yield* SessionStats.get({ projectID, from: 0, to: 2_000, tools: "none" })
    expect(stats.steps).toBe(7)
    expect(stats.cost).toBeCloseTo(1)
    expect(stats.models).toHaveLength(4)
    expect(
      stats.models.map((item) => [
        String(item.model.providerID),
        String(item.model.id),
        String(item.model.variant),
        item.steps,
        Number(item.cost),
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["kilo", "kilo-auto/free", "high", 3, 0.3],
        ["kilo", "openai/gpt-5.5", "high", 2, 0.1],
        ["kilo", "anthropic/claude-sonnet-4.6", "high", 1, 0.2],
        ["anthropic", "claude-sonnet-4.6", "high", 1, 0.4],
      ]),
    )
    expect(stats.models.find((item) => item.model.id === "openai/gpt-5.5")?.tokens).toEqual({
      input: 20,
      output: 10,
      reasoning: 4,
      cache: { read: 8, write: 2 },
    })
    const stored = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)
    expect(stored.find((row) => row.seq === 1)?.data).toMatchObject({
      model: { providerID: "kilo", id: "kilo-auto/free", variant: "high" },
      native: { kilo: { routedModelID: "openai/gpt-5.5", vercelID: "request-0" } },
    })
    expect(stored.find((row) => row.seq === 7)?.data).toMatchObject({
      model: { providerID: "anthropic", id: "claude-sonnet-4.6" },
    })
  }),
)
