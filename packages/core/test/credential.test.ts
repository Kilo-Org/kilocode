import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { Integration } from "@opencode-ai/core/integration"
// kilocode_change start
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
// kilocode_change end
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

function layer(directory: string) {
  return Credential.layer.pipe(
    Layer.fresh, // kilocode_change - rebuild so process-local credentials are re-read
    Layer.provide(Database.layerFromPath(path.join(directory, "credential.db")).pipe(Layer.fresh)),
  )
}

describe("Credential", () => {
  it.live("stores, updates, lists, and removes credentials", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const integrationID = Integration.ID.make("openai")
          const created = yield* credentials.create({
            integrationID,
            label: "Work",
            value: new Credential.Key({ type: "key", key: "secret" }),
          })

          expect(yield* credentials.list(integrationID)).toEqual([created])
          yield* credentials.update(created.id, { label: "Personal" })
          expect((yield* credentials.list(integrationID))[0]?.label).toBe("Personal")

          const replacement = yield* credentials.create({
            integrationID,
            label: "Replacement",
            value: new Credential.Key({ type: "key", key: "replacement" }),
          })
          expect(yield* credentials.list(integrationID)).toEqual([replacement])

          yield* credentials.remove(replacement.id)
          expect(yield* credentials.list(integrationID)).toEqual([])
        }).pipe(Effect.provide(layer(tmp.path))),
      ),
    ),
  )

  // kilocode_change start - process-provided credentials remain isolated from durable storage
  it.live("keeps valid KILO_AUTH_CONTENT credentials and isolated mutations process-local", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.KILO_AUTH_CONTENT
        process.env.KILO_AUTH_CONTENT = JSON.stringify({
          kilocode: {
            type: "oauth",
            refresh: "refresh",
            access: "access",
            expires: 123,
            accountId: "organization",
          },
          azure: { type: "api", key: "key" },
          "https://config.example.com": { type: "wellknown", key: "TOKEN", token: "config-token" },
          invalid: { type: "api" },
        })
        return previous
      }),
      () =>
        Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        ).pipe(
          Effect.flatMap((tmp) =>
            Effect.gen(function* () {
              const service = yield* Credential.Service
              const all = yield* service.all()
              expect(all).toHaveLength(2)
              const kilocode = Integration.ID.make("kilocode")
              const listed = yield* service.list(kilocode)
              expect(listed).toHaveLength(1)
              expect(listed[0]).toMatchObject({
                integrationID: kilocode,
                label: "Environment",
                value: {
                  type: "oauth",
                  refresh: "refresh",
                  access: "access",
                  expires: 123,
                  metadata: { accountID: "organization" },
                },
              })

              const created = yield* service.create({
                integrationID: kilocode,
                label: "Temporary",
                value: new Credential.Key({ type: "key", key: "temporary" }),
              })
              expect(yield* service.list(kilocode)).toEqual([created])
              yield* service.update(created.id, { label: "Updated" })
              expect((yield* service.list(kilocode))[0]?.label).toBe("Updated")
              yield* service.remove(created.id)
              expect(yield* service.list(kilocode)).toEqual([])

              delete process.env.KILO_AUTH_CONTENT
              const stored = yield* Effect.gen(function* () {
                return yield* (yield* Credential.Service).all()
              }).pipe(Effect.provide(layer(tmp.path)), Effect.scoped)
              expect(stored).toEqual([])
            }).pipe(Effect.provide(layer(tmp.path))),
          ),
        ),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.KILO_AUTH_CONTENT
          else process.env.KILO_AUTH_CONTENT = previous
        }),
    ),
  )

  it.live("reconciles supported legacy auth.json credentials on startup", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(tmp.path, "auth.json"),
              JSON.stringify({
                openai: {
                  type: "oauth",
                  refresh: "refresh",
                  access: "access",
                  expires: 123,
                  accountId: "account",
                },
                azure: { type: "api", key: "key", metadata: { resourceName: "resource" } },
                ignored: { type: "wellknown", key: "TOKEN", token: "secret" },
              }),
            ),
          )
          const database = Database.layerFromPath(path.join(tmp.path, "credential.db")).pipe(Layer.fresh)
          const global = Global.layerWith({ data: tmp.path })
          const importer = Credential.legacyImportLayer.pipe(
            Layer.provide(database),
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(global),
          )
          const credentials = Credential.layer.pipe(Layer.provide(database), Layer.provideMerge(importer))
          const result = yield* Effect.gen(function* () {
            const service = yield* Credential.Service
            return yield* service.all()
          }).pipe(Effect.provide(credentials), Effect.scoped)

          expect(result).toHaveLength(2)
          expect(result).toContainEqual(
            expect.objectContaining({
              integrationID: Integration.ID.make("openai"),
              label: "Imported",
              value: expect.objectContaining({
                type: "oauth",
                methodID: Integration.MethodID.make("chatgpt-browser"),
                refresh: "refresh",
                access: "access",
                expires: 123,
                metadata: { accountID: "account" },
              }),
            }),
          )
          expect(result).toContainEqual(
            expect.objectContaining({
              integrationID: Integration.ID.make("azure"),
              value: expect.objectContaining({ type: "key", key: "key", metadata: { resourceName: "resource" } }),
            }),
          )

          // a released client can update auth.json after the import; the next startup reconciles the stored value
          yield* Effect.promise(() =>
            Bun.write(
              path.join(tmp.path, "auth.json"),
              JSON.stringify({ azure: { type: "api", key: "updated", metadata: { resourceName: "resource" } } }),
            ),
          )
          yield* importer.pipe(Layer.build, Effect.scoped)
          const after = yield* Effect.gen(function* () {
            const service = yield* Credential.Service
            return {
              all: yield* service.all(),
              azure: yield* service.list(Integration.ID.make("azure")),
            }
          }).pipe(Effect.provide(credentials), Effect.scoped)
          expect(after.all).toHaveLength(2)
          expect(after.azure).toHaveLength(1)
          expect(after.azure[0]?.value).toMatchObject({ type: "key", key: "updated" })
        }),
      ),
    ),
  )

  it.live("dual-writes stored credentials for released auth.json readers", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const database = Database.layerFromPath(path.join(tmp.path, "credential.db")).pipe(Layer.fresh)
        const global = Global.layerWith({ data: tmp.path })
        const credentials = Credential.layer.pipe(
          Layer.provide(database),
          Layer.provide(FSUtil.defaultLayer),
          Layer.provide(global),
        )
        return Effect.gen(function* () {
          const service = yield* Credential.Service
          const integrationID = Integration.ID.make("legacy-reader")
          yield* service.create({
            integrationID,
            value: new Credential.Key({ type: "key", key: "first" }),
          })
          expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "auth.json")).json())).toMatchObject({
            "legacy-reader": { type: "api", key: "first" },
          })

          const replacement = yield* service.create({
            integrationID,
            value: new Credential.Key({ type: "key", key: "other" }),
          })
          expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "auth.json")).json())).toMatchObject({
            "legacy-reader": { type: "api", key: "other" },
          })

          yield* service.update(replacement.id, { value: new Credential.Key({ type: "key", key: "second" }) })
          expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "auth.json")).json())).toMatchObject({
            "legacy-reader": { type: "api", key: "second" },
          })

          yield* service.remove(replacement.id)
          expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "auth.json")).json())).not.toHaveProperty(
            "legacy-reader",
          )

          const file = path.join(tmp.path, "auth.json")
          yield* Effect.promise(() => Bun.write(file, "{"))
          yield* service.create({
            integrationID: Integration.ID.make("malformed-reader"),
            value: new Credential.Key({ type: "key", key: "safe" }),
          })
          expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("{")

          yield* Effect.promise(() => Bun.write(file, "{}"))
          yield* Effect.all(
            ["first-reader", "second-reader"].map((name) =>
              service.create({
                integrationID: Integration.ID.make(name),
                value: new Credential.Key({ type: "key", key: name }),
              }),
            ),
            { concurrency: "unbounded" },
          )
          expect(yield* Effect.promise(() => Bun.file(file).json())).toMatchObject({
            "first-reader": { type: "api", key: "first-reader" },
            "second-reader": { type: "api", key: "second-reader" },
          })
        }).pipe(Effect.provide(credentials), Effect.scoped)
      }),
    ),
  )
  // kilocode_change end
})
