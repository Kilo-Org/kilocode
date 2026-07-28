import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { IntegrationSchema } from "@opencode-ai/core/integration/schema"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { DataMigrationTable } from "@opencode-ai/core/data-migration.sql"
import { CredentialTable } from "@opencode-ai/core/credential/sql"
import { tmpdir } from "../fixture/tmpdir"
import { it } from "../lib/effect"

function layer(dir: string) {
  const database = Database.layerFromPath(path.join(dir, "credential.db")).pipe(Layer.fresh)
  const importer = Credential.legacyImportLayer.pipe(
    Layer.provide(database),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Global.layerWith({ data: dir })),
  )
  return Credential.layer.pipe(
    Layer.provide(database),
    Layer.provide(EventV2.defaultLayer),
    Layer.provideMerge(importer),
  )
}

const auth = Effect.acquireRelease(
  Effect.sync(() => {
    const value = process.env.KILO_AUTH_CONTENT
    delete process.env.KILO_AUTH_CONTENT
    return value
  }),
  (value) =>
    Effect.sync(() => {
      if (value === undefined) delete process.env.KILO_AUTH_CONTENT
      else process.env.KILO_AUTH_CONTENT = value
    }),
)

describe("Credential auth-v2 migration", () => {
  it.live("imports every account with the active account ordered last", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        auth.pipe(
          Effect.flatMap(() =>
            Effect.gen(function* () {
              const store = {
                version: 2,
                accounts: {
                  acc_first: {
                    id: "acc_first",
                    serviceID: "kilo",
                    description: "first",
                    credential: {
                      type: "oauth",
                      refresh: "refresh-first",
                      access: "access-first",
                      expires: 1,
                      accountId: "org-first",
                    },
                  },
                  acc_second: {
                    id: "acc_second",
                    serviceID: "kilo",
                    description: "second",
                    credential: {
                      type: "oauth",
                      refresh: "refresh-second",
                      access: "access-second",
                      expires: 2,
                      accountId: "org-second",
                    },
                  },
                },
                active: { kilo: "acc_second" },
              }
              yield* Effect.promise(() => Bun.write(path.join(tmp.path, "auth-v2.json"), JSON.stringify(store)))

              const result = yield* Effect.gen(function* () {
                const credentials = yield* Credential.Service
                return {
                  all: yield* credentials.all(),
                  list: yield* credentials.list(IntegrationSchema.ID.make("kilo")),
                }
              }).pipe(Effect.provide(layer(tmp.path)))

              expect(result.all.map((item) => item.label)).toEqual(["first", "second"])
              expect(result.list.length).toBe(2)
              const active = result.list.at(-1)
              expect(active?.value.type).toBe("oauth")
              if (active?.value.type === "oauth") {
                expect(active.value.access).toBe("access-second")
                expect(active.value.metadata?.accountID).toBe("org-second")
              }
            }),
          ),
        ),
      ),
    ),
  )

  it.live("repairs an active-only v2 import without duplicating the active account", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        auth.pipe(
          Effect.flatMap(() =>
            Effect.gen(function* () {
              const integration = IntegrationSchema.ID.make("kilo")
              const active = new Credential.OAuth({
                type: "oauth",
                methodID: IntegrationSchema.MethodID.make("oauth"),
                refresh: "refresh-second",
                access: "access-second",
                expires: 2,
                metadata: { accountID: "org-second" },
              })
              const database = Database.layerFromPath(path.join(tmp.path, "credential.db")).pipe(Layer.fresh)
              yield* Effect.gen(function* () {
                const { db } = yield* Database.Service
                yield* db.insert(CredentialTable).values({
                  id: Credential.ID.create(),
                  integration_id: integration,
                  label: "second",
                  value: active,
                })
                yield* db.insert(DataMigrationTable).values({
                  name: "credential.kilo-account-json-v2",
                  time_completed: Date.now(),
                })
              }).pipe(Effect.provide(database))

              yield* Effect.promise(() =>
                Bun.write(
                  path.join(tmp.path, "auth-v2.json"),
                  JSON.stringify({
                    version: 2,
                    accounts: {
                      acc_first: {
                        id: "acc_first",
                        serviceID: "kilo",
                        description: "first",
                        credential: {
                          type: "oauth",
                          refresh: "refresh-first",
                          access: "access-first",
                          expires: 1,
                          accountId: "org-first",
                        },
                      },
                      acc_second: {
                        id: "acc_second",
                        serviceID: "kilo",
                        description: "second",
                        credential: {
                          type: "oauth",
                          refresh: "refresh-second",
                          access: "access-second",
                          expires: 2,
                          accountId: "org-second",
                        },
                      },
                    },
                    active: { kilo: "acc_second" },
                  }),
                ),
              )

              const result = yield* Effect.gen(function* () {
                const credentials = yield* Credential.Service
                return yield* credentials.list(integration)
              }).pipe(Effect.provide(layer(tmp.path)))
              const repaired = yield* Effect.gen(function* () {
                const { db } = yield* Database.Service
                return yield* db
                  .select()
                  .from(DataMigrationTable)
                  .where(eq(DataMigrationTable.name, "credential.kilo-account-json-v3"))
                  .get()
              }).pipe(Effect.provide(database))

              expect(result.map((item) => item.label)).toEqual(["first", "second"])
              expect(result.filter((item) => item.label === "second")).toHaveLength(1)
              expect(repaired).toBeDefined()
            }),
          ),
        ),
      ),
    ),
  )
})
