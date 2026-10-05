import { afterEach, describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { disposeAllInstances } from "../fixture/fixture"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { Provider } from "@/provider/provider"
import { providerMetadata } from "../../src/kilocode/provider/metadata"
import { testEffect } from "../lib/effect"

const original = new Map<string, string | undefined>()

const remember = (key: string) => {
  if (!original.has(key)) original.set(key, process.env[key])
}

const set = (key: string, value: string) =>
  Effect.gen(function* () {
    remember(key)
    process.env[key] = value
    yield* Env.use.set(key, value)
  })

afterEach(async () => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  original.clear()
  await disposeAllInstances()
})

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))
const id = ProviderV2.ID.make("gmicloud")

const auth = (key: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.KILO_AUTH_CONTENT
      process.env.KILO_AUTH_CONTENT = JSON.stringify({ gmicloud: { type: "api", key } })
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.KILO_AUTH_CONTENT
        else process.env.KILO_AUTH_CONTENT = previous
      }),
  )

const bearer = (language: unknown) => {
  const headers = (language as { config: { headers: () => Record<string, string | undefined> } }).config.headers()
  return headers.authorization ?? headers.Authorization
}

const endpoint = (language: unknown) =>
  (language as { config: { url: (input: { path: string }) => string } }).config.url({ path: "/chat/completions" })

const prove = (key: string) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const item = (yield* provider.list())[id]
    expect(item).toBeDefined()
    const model = Object.values(item.models).at(0)
    expect(model).toBeDefined()
    const language = yield* provider.getLanguage(model!)
    expect(bearer(language)).toBe(`Bearer ${key}`)
    expect(endpoint(language)).toStartWith("https://api.gmi-serving.com/v1")
    return item
  })

test("uses the GMI Cloud icon", () => {
  expect(providerMetadata("gmicloud")).toEqual({ icon: "gmicloud" })
})

describe.serial("gmicloud authentication", () => {
  it.instance("GMICLOUD_API_KEY alone authenticates gmicloud", () =>
    Effect.gen(function* () {
      yield* set("GMICLOUD_API_KEY", "catalog-key")
      const item = yield* prove("catalog-key")
      expect(item.key).toBe("catalog-key")
    }),
  )

  it.instance("GMI_API_KEY alone authenticates gmicloud", () =>
    Effect.gen(function* () {
      yield* set("GMI_API_KEY", "alias-key")
      const item = yield* prove("alias-key")
      expect(item.options.apiKey).toBe("alias-key")
      expect(item.key).toBeUndefined()
    }),
  )

  it.instance("a saved API key wins over GMI_API_KEY", () =>
    Effect.gen(function* () {
      yield* auth("saved-key")
      yield* set("GMI_API_KEY", "alias-key")
      const item = yield* prove("saved-key")
      expect(item.key).toBe("saved-key")
      expect(item.options.apiKey).not.toBe("alias-key")
    }),
  )

  it.instance(
    "a configured API key wins over GMI_API_KEY",
    () =>
      Effect.gen(function* () {
        yield* set("GMI_API_KEY", "alias-key")
        const item = yield* prove("config-key")
        expect(item.options.apiKey).toBe("config-key")
      }),
    { config: { provider: { gmicloud: { options: { apiKey: "config-key" } } } } },
  )

  it.instance("GMICLOUD_API_KEY wins over GMI_API_KEY", () =>
    Effect.gen(function* () {
      yield* set("GMICLOUD_API_KEY", "catalog-key")
      yield* set("GMI_API_KEY", "alias-key")
      const item = yield* prove("catalog-key")
      expect(item.key).toBe("catalog-key")
      expect(item.options.apiKey).not.toBe("alias-key")
    }),
  )

  it.instance("no env means no gmicloud provider", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.use.list()
      expect(providers[id]).toBeUndefined()
    }),
  )
})
