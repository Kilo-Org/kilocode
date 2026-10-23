import { describe, expect, test } from "bun:test"
import type { ModelInfo } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { buildModelPickerOptions, modelFooter, RECOMMENDED_CATEGORY } from "../../src/kilocode/model-picker"

// kilo_port(tui:c29e2d297ca2) the v1 picker order, labels and search rules, on v2 model info and Gateway metadata.

function model(providerID: string, id: string, input = 1, name = id): ModelInfo {
  return {
    id,
    modelID: id,
    providerID,
    name,
    status: "active",
    enabled: true,
    capabilities: { input: ["text"], output: ["text"], tools: true },
    cost: [{ input, output: input, cache: { read: 0, write: 0 } }],
    limit: { context: 128_000, output: 8_192 },
    time: { released: 0 },
    variants: [],
  }
}

function entry(id: string, value: Partial<KiloGatewayRpc.ModelEntry> = {}): KiloGatewayRpc.ModelEntry {
  return { id, name: id, isFree: false, ...value }
}

const providers = new Map([
  ["kilo", { name: "Kilo Gateway" }],
  ["anthropic", { name: "Anthropic" }],
  ["opencode", { name: "OpenCode Zen" }],
  ["amazon-bedrock", { name: "Amazon Bedrock" }],
])

// Server order: OpenCode first (the upstream preference this picker removes), then newest first.
const models = [
  model("opencode", "claude-sonnet-4", 3, "Claude Sonnet 4 (Zen)"),
  model("kilo", "openai/gpt-5", 5, "OpenAI: GPT-5"),
  model("kilo", "kilo-auto/free", 0, "Auto Free"),
  model("anthropic", "claude-opus-4", 15, "Claude Opus 4"),
  model("kilo", "anthropic/claude-sonnet-4.5", 3, "Anthropic: Claude Sonnet 4.5"),
  model("kilo", "x-ai/grok-code-fast", 0, "xAI: Grok Code Fast"),
  model("amazon-bedrock", "anthropic.claude-sonnet-4", 3, "Claude Sonnet 4 (Bedrock)"),
  model("kilo", "anthropic/claude-opus-4.5", 15, "Anthropic: Claude Opus 4.5"),
]

const gateway = new Map(
  [
    entry("anthropic/claude-opus-4.5", { recommendedIndex: 1 }),
    entry("anthropic/claude-sonnet-4.5", { recommendedIndex: 0, hasUserByokAvailable: true }),
    entry("kilo-auto/free", { isFree: true }),
    entry("x-ai/grok-code-fast", { isFree: true, mayTrainOnYourPrompts: true }),
    entry("openai/gpt-5"),
  ].map((item) => [item.id, item]),
)

const sonnet = { providerID: "kilo", modelID: "anthropic/claude-sonnet-4.5" }
const opus = { providerID: "anthropic", modelID: "claude-opus-4" }
const bedrock = { providerID: "amazon-bedrock", modelID: "anthropic.claude-sonnet-4" }

function build(input: Partial<Parameters<typeof buildModelPickerOptions>[0]> = {}) {
  return buildModelPickerOptions({
    models,
    providers,
    gateway,
    favorites: [],
    recents: [],
    connected: true,
    showExtra: true,
    query: "",
    onSelect: () => {},
    ...input,
  })
}

const rows = (options: ReturnType<typeof build>) => options.map((item) => `${item.category ?? ""} | ${item.modelID}`)

describe("model picker order", () => {
  test("lists Favorites and Recent in stored order, then Recommended, Kilo Gateway and the other providers", () => {
    expect(rows(build({ favorites: [opus], recents: [bedrock, sonnet] }))).toEqual([
      "Favorites | claude-opus-4",
      "Recent | anthropic.claude-sonnet-4",
      "Recent | anthropic/claude-sonnet-4.5",
      "Recommended | anthropic/claude-sonnet-4.5",
      "Recommended | anthropic/claude-opus-4.5",
      // Free first, then the server order.
      "Kilo Gateway | kilo-auto/free",
      "Kilo Gateway | x-ai/grok-code-fast",
      "Kilo Gateway | openai/gpt-5",
      // Other providers by name. OpenCode is not first any more, and the favorite moved to its own section.
      "Amazon Bedrock | anthropic.claude-sonnet-4",
      "OpenCode Zen | claude-sonnet-4",
    ])
  })

  test("signed out (no connected integration) keeps the order without section headers and hides nothing", () => {
    const options = build({ connected: false, showExtra: false, recents: [bedrock] })
    expect(options.every((item) => item.category === undefined)).toBe(true)
    expect(options.map((item) => item.modelID)).toEqual([
      "anthropic/claude-sonnet-4.5",
      "anthropic/claude-opus-4.5",
      "kilo-auto/free",
      "x-ai/grok-code-fast",
      "openai/gpt-5",
      "anthropic.claude-sonnet-4",
      "claude-opus-4",
      "claude-sonnet-4",
    ])
  })

  test("without Gateway metadata, Kilo models still come first in the server order", () => {
    expect(rows(build({ gateway: new Map() })).slice(0, 5)).toEqual([
      "Kilo Gateway | openai/gpt-5",
      "Kilo Gateway | kilo-auto/free",
      "Kilo Gateway | anthropic/claude-sonnet-4.5",
      "Kilo Gateway | x-ai/grok-code-fast",
      "Kilo Gateway | anthropic/claude-opus-4.5",
    ])
  })

  test("a provider dialog lists only that provider", () => {
    expect(rows(build({ providerID: "anthropic", showExtra: false }))).toEqual(["Anthropic | claude-opus-4"])
  })

  test("a model that the training policy removed from the model list gets no row", () => {
    // `hide_prompt_training_models` removes the model from the model list; the Gateway RPC still returns it.
    const options = build({ models: models.filter((item) => item.id !== "x-ai/grok-code-fast") })
    expect(options.map((item) => item.modelID)).not.toContain("x-ai/grok-code-fast")
    expect(options.some((item) => item.footer?.includes("May train"))).toBe(false)
  })

  test("a config alias of a Gateway model uses the metadata of its Gateway ID", () => {
    const alias = { ...model("kilo", "fast", 0, "Fast"), modelID: "x-ai/grok-code-fast" }
    const options = build({ models: [alias] })
    expect(options.map((item) => [item.modelID, item.footer])).toEqual([["fast", "Free · May train"]])
  })
})

describe("model picker search", () => {
  test("matches the provider name and keeps the section headers", () => {
    const options = build({ query: "kilo", recents: [sonnet] })
    expect(options.every((item) => item.providerID === "kilo")).toBe(true)
    expect(options.filter((item) => item.category === RECOMMENDED_CATEGORY).map((item) => item.modelID)).toEqual(
      expect.arrayContaining(["anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.5"]),
    )
    expect(options.filter((item) => item.category === "Kilo Gateway").map((item) => item.modelID)).toContain(
      "openai/gpt-5",
    )
    expect(options.filter((item) => item.category === "Recent").map((item) => item.modelID)).toEqual([sonnet.modelID])
  })

  test("matches provider and model IDs and finds other providers", () => {
    expect(build({ query: "amazon-bedrock" }).map((item) => item.modelID)).toEqual(["anthropic.claude-sonnet-4"])
    expect(build({ query: "openai/gpt-5" }).map((item) => item.modelID)).toEqual(["openai/gpt-5"])
    expect(rows(build({ query: "zen" }))).toEqual(["OpenCode Zen | claude-sonnet-4"])
  })

  test("matches a model title after a vendor prefix", () => {
    expect(build({ query: "grok" }).map((item) => item.modelID)).toEqual(["x-ai/grok-code-fast"])
  })
})

describe("model picker labels", () => {
  const footers = (options: ReturnType<typeof build>) =>
    Object.fromEntries(options.map((item) => [`${item.providerID}/${item.modelID}`, item.footer]))

  test("uses Gateway isFree, BYOK and training metadata for Kilo models", () => {
    expect(footers(build())).toMatchObject({
      "kilo/kilo-auto/free": "Free",
      "kilo/x-ai/grok-code-fast": "Free · May train",
      "kilo/anthropic/claude-sonnet-4.5": "BYOK",
      "kilo/openai/gpt-5": undefined,
    })
  })

  test("does not infer Free from the price of a Kilo model", () => {
    const free = model("kilo", "zero-price", 0)
    expect(modelFooter(free, entry("zero-price"))).toBeUndefined()
    expect(modelFooter(free, undefined)).toBeUndefined()
    expect(modelFooter(model("kilo", "promo", 3), entry("promo", { isFree: true }))).toBe("Free")
  })

  test("keeps the price rule and no Gateway labels for other providers", () => {
    expect(modelFooter(model("opencode", "free", 0), entry("free", { mayTrainOnYourPrompts: true }))).toBe("Free")
    expect(modelFooter(model("anthropic", "paid", 3), undefined)).toBeUndefined()
  })
})
