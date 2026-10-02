import { describe, expect, test } from "bun:test"
import type { Provider } from "@opencode-ai/core/models-dev"
import { alias } from "../../src/kilocode/provider/gmicloud"
import { providerMetadata } from "../../src/kilocode/provider/metadata"

const catalog = {
  id: "gmicloud",
  name: "GMI Cloud",
  env: ["GMICLOUD_API_KEY"],
  api: "https://api.gmi-serving.com/v1",
  npm: "@ai-sdk/openai-compatible",
  models: {},
} satisfies Provider

describe("gmicloud provider", () => {
  test("accepts GMI_API_KEY alongside the models.dev env var", () => {
    const providers = { gmicloud: catalog }
    const next = alias(providers)

    expect(next.gmicloud.env).toEqual(["GMICLOUD_API_KEY", "GMI_API_KEY"])
    expect(providers.gmicloud.env).toEqual(["GMICLOUD_API_KEY"])
  })

  test("keeps an existing GMI_API_KEY entry", () => {
    const providers = { gmicloud: { ...catalog, env: ["GMICLOUD_API_KEY", "GMI_API_KEY"] } }

    expect(alias(providers)).toBe(providers)
  })

  test("leaves catalogs without GMI Cloud unchanged", () => {
    const providers = {}

    expect(alias(providers)).toBe(providers)
  })

  test("uses the GMI Cloud icon", () => {
    expect(providerMetadata("gmicloud")).toEqual({ icon: "gmicloud" })
  })
})
