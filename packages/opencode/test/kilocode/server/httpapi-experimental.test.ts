import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Session } from "../../../src/session/session"
import { Server } from "../../../src/server/server"
import { ExperimentalPaths } from "../../../src/server/routes/instance/httpapi/groups/experimental"
import { disposeAllInstances, TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(Session.defaultLayer))

function app() {
  return Server.Default().app
}

function request(path: string, directory: string, init: RequestInit = {}) {
  return Effect.promise(() => {
    const headers = new Headers(init.headers)
    headers.set("x-kilo-directory", directory)
    return Promise.resolve(app().request(path, { ...init, headers }))
  })
}

function json<T>(response: Response) {
  return Effect.promise(() => response.json() as Promise<T>)
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("Kilo experimental HttpApi", () => {
  it.instance(
    "uses model family metadata for experimental editing tools",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const family = yield* request(
          `${ExperimentalPaths.tool}?provider=test-provider&model=routed-model`,
          tmp.directory,
        )
        const fallback = yield* request(`${ExperimentalPaths.tool}?provider=missing&model=unknown`, tmp.directory)

        expect(family.status).toBe(200)
        const familyIDs = (yield* json<Array<{ id: string }>>(family)).map((tool) => tool.id)
        expect(familyIDs).toContain("apply_patch")
        expect(familyIDs).not.toContain("edit")

        expect(fallback.status).toBe(200)
        const fallbackIDs = (yield* json<Array<{ id: string }>>(fallback)).map((tool) => tool.id)
        expect(fallbackIDs).toContain("edit")
      }),
    {
      config: {
        formatter: false,
        lsp: false,
        provider: {
          "test-provider": {
            npm: "@ai-sdk/openai-compatible",
            env: [],
            models: {
              "routed-model": {
                id: "opaque-api-model",
                family: "gpt-codex",
              },
            },
          },
        },
      },
    },
    30_000,
  )
})
