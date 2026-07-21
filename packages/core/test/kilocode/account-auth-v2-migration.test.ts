import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Connector } from "@opencode-ai/core/connector"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
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
  it.live("preserves multiple accounts, active selection, and Kilo organization", () =>
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
                  active: yield* credentials.active(Connector.ID.make("kilo")),
                }
              }).pipe(Effect.provide(layer(tmp.path)))

              expect(result.all.map((item) => item.label)).toEqual(["first", "second"])
              expect(result.active?.label).toBe("second")
              expect(result.active?.value.type).toBe("oauth")
              if (result.active?.value.type === "oauth") {
                expect(result.active.value.access).toBe("access-second")
                expect(result.active.value.metadata?.accountID).toBe("org-second")
              }
            }),
          ),
        ),
      ),
    ),
  )
})
