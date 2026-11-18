import { expect, test } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// An `@`-mentioned past chat reaches the server as a `session:` prompt file, which the server's attachment reader does
// not accept. The Kilo host's recall plugin must turn it into the session's transcript before the prompt is admitted.
test("the Kilo host admits a past chat mention as the session's transcript", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-session-mention-")))
  try {
    const admitted = await Effect.runPromise(
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
          const sessions = Context.get(context, Session.Service)
          const currentID = Session.ID.make("ses_mention_current")
          const pastID = Session.ID.make("ses_mention_past")
          yield* Effect.gen(function* () {
            const plugins = yield* Plugin.Service
            yield* plugins.awaitActivation
            const location = yield* Location.Service
            const { db } = yield* Database.Service
            yield* db
              .insert(SessionTable)
              .values([
                {
                  id: currentID,
                  project_id: location.project.id,
                  slug: "mention-current",
                  directory: root,
                  title: "current chat",
                  version: "test",
                },
                {
                  id: pastID,
                  project_id: location.project.id,
                  slug: "mention-past",
                  directory: root,
                  title: "Rotate signing keys",
                  version: "test",
                },
              ])
              .run()
              .pipe(Effect.orDie)
            yield* db
              .insert(SessionMessageTable)
              .values({
                id: SessionMessage.ID.make("msg_mention_past"),
                session_id: pastID,
                type: "user",
                seq: 0,
                time_created: 1,
                data: { text: "how do I rotate the signing keys?", time: { created: 1 } } as never,
              })
              .run()
              .pipe(Effect.orDie)
          }).pipe(
            Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(root) }))),
            Effect.provideService(Database.Service, database),
          )
          return yield* sessions.prompt({
            sessionID: currentID,
            text: "Compare with @Rotate signing keys",
            files: [
              {
                uri: `session:${pastID}`,
                name: "Rotate-signing-keys.md",
                mention: { text: "@Rotate signing keys", start: 13, end: 33 },
              },
            ],
            resume: false,
          })
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )

    const file = admitted.payload.files?.[0]
    expect(file).toBeDefined()
    expect(file!.mime).toBe("text/plain")
    expect(file!.name).toBe("Rotate-signing-keys.md")
    expect(file!.source).toEqual({ type: "uri", uri: "session:ses_mention_past" })
    expect(file!.mention).toEqual({ text: "@Rotate signing keys", start: 13, end: 33 })
    expect(file!.description).toContain('Attached transcript of past chat "Rotate signing keys" (ses_mention_past)')
    const transcript = "data" in file! ? Buffer.from(file!.data, "base64").toString("utf8") : ""
    expect(transcript).toContain("# Session: Rotate signing keys")
    expect(transcript).toContain("how do I rotate the signing keys?")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
