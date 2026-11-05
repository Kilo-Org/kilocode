import { expect, test } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { Agent } from "@opencode/schema/agent"
import { codeModeListings, executeTool } from "../../core/test/lib/tool"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

test("the Kilo host registers kilo_local_recall as a Code Mode tool", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-recall-")))
  try {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory: root, project: false },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const locations = Context.get(context, LocationServiceMap.Service)
          const database = Context.get(context, Database.Service)
          return yield* Effect.gen(function* () {
            const plugins = yield* Plugin.Service
            yield* plugins.awaitActivation
            const tools = yield* Tool.Service
            const snapshot = yield* tools.snapshot()
            const listings = codeModeListings(snapshot.codeModeCatalog!)
            const tool = (yield* tools.list()).find((item) => item.name === "kilo_local_recall")
            const location = yield* Location.Service
            const { db } = yield* Database.Service
            const sessionID = Session.ID.make("ses_recall_e2e")
            const historyID = Session.ID.make("ses_recall_history")
            yield* db
              .insert(SessionTable)
              .values([
                {
                  id: sessionID,
                  project_id: location.project.id,
                  slug: "recall-e2e",
                  directory: root,
                  title: "recall reader",
                  version: "test",
                  permission: [{ action: "recall", resource: "*", effect: "allow" }],
                },
                {
                  id: historyID,
                  project_id: location.project.id,
                  slug: "recall-history",
                  directory: root,
                  title: "recall history",
                  version: "test",
                },
              ])
              .run()
              .pipe(Effect.orDie)
            yield* db
              .insert(SessionMessageTable)
              .values({
                id: SessionMessage.ID.make("msg_recall_history"),
                session_id: historyID,
                type: "user",
                seq: 0,
                time_created: 1,
                data: { text: "recall-needle", time: { created: 1 } } as never,
              })
              .run()
              .pipe(Effect.orDie)
            const execution = yield* executeTool(tools, {
              sessionID,
              agent: Agent.ID.make("code"),
              messageID: SessionMessage.ID.make("msg_recall_call"),
              call: {
                type: "tool-call",
                id: "call_recall_e2e",
                name: "execute",
                input: {
                  code: 'return await tools.kilo_local_recall({ mode: "search", query: "recall-needle" })',
                },
              },
            })
            return { listings, tool, execution }
          }).pipe(
            Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(root) }))),
            Effect.provideService(Database.Service, database),
          )
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )

    const recall = result.listings.find((item) => item.path === "kilo_local_recall")
    expect(recall).toBeDefined()
    expect(recall!.line).toContain("Search and read past sessions in this project and its git worktrees.")
    expect(result.tool).toBeDefined()
    expect(result.tool!.options?.codemode).not.toBe(false)
    expect(result.tool!.description.split("\n")[0]!.length).toBeLessThanOrEqual(120)

    expect(result.execution.status).toBe("completed")
    const text = result.execution.content?.map((part) => (part.type === "text" ? part.text : "")).join("") ?? ""
    expect(text).toContain("recall history")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
