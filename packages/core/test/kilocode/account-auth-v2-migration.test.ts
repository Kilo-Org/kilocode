import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AccountV2 } from "@opencode-ai/core/account"
import { EventV2 } from "@opencode-ai/core/event"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../fixture/tmpdir"
import { it } from "../lib/effect"

function layer(dir: string) {
  return AccountV2.layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provide(Global.layerWith({ data: dir })),
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

describe("AccountV2 auth-v2 migration", () => {
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
                const accounts = yield* AccountV2.Service
                return {
                  all: yield* accounts.all(),
                  active: yield* accounts.active(AccountV2.ServiceID.make("kilo")),
                }
              }).pipe(Effect.provide(layer(tmp.path)))

              expect(result.all.map((item) => String(item.id))).toEqual(["acc_first", "acc_second"])
              expect(String(result.active?.id)).toBe("acc_second")
              expect(result.active?.credential.type).toBe("oauth")
              if (result.active?.credential.type === "oauth") {
                expect(result.active.credential.access).toBe("access-second")
                expect(result.active.credential.accountId).toBe("org-second")
              }
              const saved = yield* Effect.promise(() => Bun.file(path.join(tmp.path, "account.json")).json())
              expect(saved).toEqual(store)
            }),
          ),
        ),
      ),
    ),
  )
})
