import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Connector } from "@opencode-ai/core/connector"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(PluginV2.locationLayer.pipe(Layer.provide(EventV2.defaultLayer)))

function testLayer(directory: string) {
  return Credential.layer.pipe(
    Layer.fresh,
    Layer.provide(Database.layerFromPath(path.join(directory, "credential.db")).pipe(Layer.fresh)),
    Layer.provideMerge(EventV2.defaultLayer),
  )
}

describe("Credential", () => {
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
              const initial = yield* service.active(Connector.ID.make("kilocode"))
              expect(initial).toMatchObject({
                connectorID: Connector.ID.make("kilocode"),
                methodID: Connector.MethodID.make("oauth"),
                label: "Environment",
                value: {
                  type: "oauth",
                  refresh: "refresh",
                  access: "access",
                  expires: 123,
                  metadata: { accountID: "organization" },
                },
              })
              expect(initial).toBeDefined()
              if (!initial) return

              const created = yield* service.create({
                connectorID: Connector.ID.make("kilocode"),
                methodID: Connector.MethodID.make("api-key"),
                label: "Temporary",
                value: new Credential.Key({ type: "key", key: "temporary" }),
              })
              yield* service.update(created.id, { label: "Updated" })
              expect((yield* service.active(Connector.ID.make("kilocode")))?.label).toBe("Updated")
              yield* service.activate(initial.id)
              expect((yield* service.active(Connector.ID.make("kilocode")))?.id).toBe(initial.id)
              yield* service.remove(initial.id)
              expect((yield* service.active(Connector.ID.make("kilocode")))?.id).toBe(created.id)

              delete process.env.KILO_AUTH_CONTENT
              const stored = yield* Effect.gen(function* () {
                return yield* (yield* Credential.Service).all()
              }).pipe(Effect.provide(testLayer(tmp.path)), Effect.scoped)
              expect(stored).toEqual([])
            }).pipe(Effect.provide(testLayer(tmp.path))),
          ),
        ),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.KILO_AUTH_CONTENT
          else process.env.KILO_AUTH_CONTENT = previous
        }),
    ),
  )

  // kilocode_change end
  // kilocode_change - released auth.json remains authoritative when reconciling on startup
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
          const credentials = Credential.layer.pipe(
            Layer.provide(database),
            Layer.provide(EventV2.defaultLayer),
            Layer.provideMerge(importer),
          )
          const result = yield* Effect.gen(function* () {
            const service = yield* Credential.Service
            return yield* service.all()
          }).pipe(Effect.provide(credentials), Effect.scoped)

          expect(result).toHaveLength(2)
          expect(result).toContainEqual(
            expect.objectContaining({
              connectorID: Connector.ID.make("openai"),
              methodID: Connector.MethodID.make("chatgpt-browser"),
              label: "Imported",
              value: expect.objectContaining({
                type: "oauth",
                refresh: "refresh",
                access: "access",
                expires: 123,
                metadata: { accountID: "account" },
              }),
            }),
          )
          expect(result).toContainEqual(
            expect.objectContaining({
              connectorID: Connector.ID.make("azure"),
              methodID: Connector.MethodID.make("api-key"),
              value: expect.objectContaining({ type: "key", key: "key", metadata: { resourceName: "resource" } }),
            }),
          )

          // kilocode_change start - update the selected row when a released client changes auth.json.
          const selected = yield* Effect.gen(function* () {
            return yield* (yield* Credential.Service).create({
              connectorID: Connector.ID.make("azure"),
              methodID: Connector.MethodID.make("api-key"),
              label: "Selected",
              value: new Credential.Key({ type: "key", key: "selected" }),
            })
          }).pipe(Effect.provide(credentials), Effect.scoped)

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
              active: yield* service.active(Connector.ID.make("azure")),
            }
          }).pipe(Effect.provide(credentials), Effect.scoped)
          expect(after.all).toHaveLength(3)
          expect(after.active).toMatchObject({
            id: selected.id,
            value: { type: "key", key: "updated" },
          })
          expect(
            after.all.find((item) => item.connectorID === Connector.ID.make("azure") && item.id !== selected.id)?.value,
          ).toMatchObject({ type: "key", key: "key" })
          // kilocode_change end
        }),
      ),
    ),
  )

  // kilocode_change start - retain downgrade-readable credential state
  it.live("dual-writes active credentials for released auth.json readers", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const database = Database.layerFromPath(path.join(tmp.path, "credential.db")).pipe(Layer.fresh)
        const global = Global.layerWith({ data: tmp.path })
        const credentials = Credential.layer.pipe(
          Layer.provide(database),
          Layer.provide(EventV2.defaultLayer),
          Layer.provide(FSUtil.defaultLayer),
          Layer.provide(global),
        )
        return Effect.gen(function* () {
          const service = yield* Credential.Service
          const connectorID = Connector.ID.make("legacy-reader")
          const created = yield* service.create({
            connectorID,
            methodID: Connector.MethodID.make("api-key"),
            value: new Credential.Key({ type: "key", key: "first" }),
          })
          expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "auth.json")).json())).toMatchObject({
            "legacy-reader": { type: "api", key: "first" },
          })

          yield* service.update(created.id, { value: new Credential.Key({ type: "key", key: "second" }) })
          expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "auth.json")).json())).toMatchObject({
            "legacy-reader": { type: "api", key: "second" },
          })

          yield* service.remove(created.id)
          expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "auth.json")).json())).not.toHaveProperty(
            "legacy-reader",
          )

          const file = path.join(tmp.path, "auth.json")
          yield* Effect.promise(() => Bun.write(file, "{"))
          yield* service.create({
            connectorID: Connector.ID.make("malformed-reader"),
            methodID: Connector.MethodID.make("api-key"),
            value: new Credential.Key({ type: "key", key: "safe" }),
          })
          expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("{")

          yield* Effect.promise(() => Bun.write(file, "{}"))
          yield* Effect.all(
            ["first-reader", "second-reader"].map((name) =>
              service.create({
                connectorID: Connector.ID.make(name),
                methodID: Connector.MethodID.make("api-key"),
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

  it.live("emits credential lifecycle events", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const eventSvc = yield* EventV2.Service
          const addedFiber = yield* eventSvc
            .subscribe(Credential.Event.Added)
            .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
          const switchedFiber = yield* eventSvc
            .subscribe(Credential.Event.Switched)
            .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
          const removedFiber = yield* eventSvc
            .subscribe(Credential.Event.Removed)
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

          yield* Effect.yieldNow

          const first = yield* credentials.create({
            connectorID: Connector.ID.make("lifecycle"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "raw-key" }),
          })
          expect(first).toBeDefined()
          if (!first) return
          expect(first.label).toBe("default")
          expect(first.value.type).toBe("key")
          if (first.value.type === "key") expect(first.value.key).toBe("raw-key")

          yield* credentials.update(first.id, { label: "keep" })
          const updated = yield* credentials.get(first.id)
          expect(updated?.label).toBe("keep")
          expect(updated?.value.type).toBe("key")
          if (updated?.value.type === "key") expect(updated.value.key).toBe("raw-key")

          const second = yield* credentials.create({
            connectorID: Connector.ID.make("lifecycle"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "second-key" }),
          })
          expect(second).toBeDefined()
          if (!second) return

          yield* credentials.remove(second.id)
          const added = Array.from(yield* Fiber.join(addedFiber))
          const switched = Array.from(yield* Fiber.join(switchedFiber))
          const removed = Array.from(yield* Fiber.join(removedFiber))
          expect(added.map((event) => event.data.credential.id)).toEqual([first.id, second.id])
          expect(switched.map((event) => event.data)).toEqual([
            { connectorID: Connector.ID.make("lifecycle"), from: undefined, to: first.id },
            { connectorID: Connector.ID.make("lifecycle"), from: first.id, to: second.id },
            { connectorID: Connector.ID.make("lifecycle"), from: second.id, to: first.id },
          ])
          expect(removed[0]?.data.credential.id).toBe(second.id)
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )

  it.live("always switches to newly created credentials", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const eventSvc = yield* EventV2.Service
          const switchedFiber = yield* eventSvc
            .subscribe(Credential.Event.Switched)
            .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)

          yield* Effect.yieldNow

          const first = yield* credentials.create({
            connectorID: Connector.ID.make("switch"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "first-key" }),
          })
          const second = yield* credentials.create({
            connectorID: Connector.ID.make("switch"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "second-key" }),
          })
          const third = yield* credentials.create({
            connectorID: Connector.ID.make("switch"),
            methodID: Connector.MethodID.make("key"),
            value: new Credential.Key({ type: "key", key: "third-key" }),
          })

          expect(first).toBeDefined()
          expect(second).toBeDefined()
          expect(third).toBeDefined()
          if (!first || !second || !third) return

          expect((yield* credentials.active(Connector.ID.make("switch")))?.id).toBe(third.id)
          expect(Array.from(yield* Fiber.join(switchedFiber)).map((event) => event.data)).toEqual([
            { connectorID: Connector.ID.make("switch"), from: undefined, to: first.id },
            { connectorID: Connector.ID.make("switch"), from: first.id, to: second.id },
            { connectorID: Connector.ID.make("switch"), from: second.id, to: third.id },
          ])
        }).pipe(Effect.provide(testLayer(tmp.path))),
      ),
    ),
  )
})
