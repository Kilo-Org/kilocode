import { afterEach, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect, Layer } from "effect"
import { Auth } from "../../../src/auth"
import { ModelCache } from "../../../src/provider/model-cache"
import { Server } from "../../../src/server/server"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"
import { testEffectShared } from "../../lib/effect"

const it = testEffectShared(Layer.merge(AppNodeBuilder.build(ModelCache.node), AppNodeBuilder.build(Auth.node)))

function request(path: string, dir: string) {
  return Effect.promise(async () => {
    const result = await Server.Default().app.request(path, { headers: { "x-kilo-directory": dir } })
    const text = await result.text()
    return { status: result.status, text, body: JSON.parse(text) as unknown }
  })
}

function ids(body: unknown, key: "all" | "providers") {
  if (typeof body !== "object" || body === null) return []
  const list = (body as Record<string, unknown>)[key]
  if (!Array.isArray(list)) return []
  return list.map((item) => (typeof item === "object" && item !== null ? (item as { id?: string }).id : undefined))
}

const config = (enabled: string[]) => ({
  formatter: false,
  lsp: false,
  enabled_providers: enabled,
  provider: {
    ...(enabled.includes("kilo")
      ? { kilo: { models: { smoke: { name: "Smoke", limit: { context: 32000, output: 1000 } } } } }
      : {}),
    external: {
      npm: "@ai-sdk/openai-compatible",
      options: { apiKey: "external-test-key" },
      models: { independent: { name: "Independent", limit: { context: 128000, output: 4096 } } },
    },
  },
})

function stagedAuth() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = {
        KILO_AUTH_CONTENT: process.env.KILO_AUTH_CONTENT,
        KILO_API_KEY: process.env.KILO_API_KEY,
        KILO_ORG_ID: process.env.KILO_ORG_ID,
      }
      process.env.KILO_AUTH_CONTENT = JSON.stringify({
        kilo: { type: "oauth", access: "staged-token", refresh: "staged-refresh", expires: 0, accountId: "staged-org" },
      })
      delete process.env.KILO_API_KEY
      delete process.env.KILO_ORG_ID
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}

function offline() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = { flag: Flag.KILO_DISABLE_MODELS_FETCH, fetch: globalThis.fetch }
      Flag.KILO_DISABLE_MODELS_FETCH = true
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
          if (url.hostname.endsWith("kilo.ai") || url.hostname.endsWith("apertis.ai"))
            return new Response(null, { status: 401 })
          return previous.fetch(input, init)
        },
        { preconnect: previous.fetch.preconnect },
      )
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        Flag.KILO_DISABLE_MODELS_FETCH = previous.flag
        globalThis.fetch = previous.fetch
      }),
  )
}

function workspace(enabled: string[]) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir({ config: config(enabled) })),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )
}

it.live("excludes Kilo while staged Kilo auth exists", () =>
  Effect.gen(function* () {
    yield* stagedAuth()
    yield* offline()
    const tmp = yield* workspace(["external"])
    const all = yield* request("/provider", tmp.path)
    const connected = yield* request("/config/providers", tmp.path)
    expect(all.status).toBe(200)
    expect(connected.status).toBe(200)
    expect(ids(all.body, "all").sort()).toEqual(["external"])
    expect(ids(connected.body, "providers").sort()).toEqual(["external"])
    expect(all.text).not.toContain("staged-token")
    expect(connected.text).not.toContain("staged-token")
  }),
)

it.live("still loads enabled Kilo with staged Kilo auth", () =>
  Effect.gen(function* () {
    yield* stagedAuth()
    yield* offline()
    const tmp = yield* workspace(["external", "kilo"])
    const all = yield* request("/provider", tmp.path)
    const connected = yield* request("/config/providers", tmp.path)
    expect(all.status).toBe(200)
    expect(connected.status).toBe(200)
    expect(ids(all.body, "all").sort()).toEqual(["external", "kilo"])
    expect(ids(connected.body, "providers").sort()).toEqual(["external", "kilo"])
    expect(all.text).not.toContain("staged-token")
    expect(connected.text).not.toContain("staged-token")
  }),
)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})
