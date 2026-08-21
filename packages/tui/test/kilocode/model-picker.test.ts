import { describe, expect, test } from "bun:test"
import {
  buildModelPickerOptions,
  RECOMMENDED_CATEGORY,
  type ModelPickerProvider,
  type ModelPickerRef,
} from "../../src/kilocode/model-picker"

const KILO: ModelPickerProvider = {
  id: "kilo",
  name: "Kilo Gateway",
  models: {
    "anthropic/claude-sonnet-4-5": {
      id: "anthropic/claude-sonnet-4-5",
      name: "Anthropic Claude Sonnet 4.5",
      release_date: "2025-09-29",
      recommendedIndex: 0,
    },
    "anthropic/claude-sonnet-4": {
      id: "anthropic/claude-sonnet-4",
      name: "Anthropic Claude Sonnet 4",
      release_date: "2025-05-22",
      recommendedIndex: 1,
    },
    "openai/gpt-5": {
      id: "openai/gpt-5",
      name: "OpenAI GPT 5",
      release_date: "2025-08-07",
    },
  },
}

const BEDROCK: ModelPickerProvider = {
  id: "amazon-bedrock",
  name: "Amazon Bedrock",
  models: {
    "anthropic.claude-sonnet-4-20250514-v1:0": {
      id: "anthropic.claude-sonnet-4-20250514-v1:0",
      name: "Claude Sonnet 4",
      release_date: "2025-05-22",
    },
  },
}

const providers = [KILO, BEDROCK]

const sonnet45: ModelPickerRef = { providerID: "kilo", modelID: "anthropic/claude-sonnet-4-5" }
const sonnet4: ModelPickerRef = { providerID: "kilo", modelID: "anthropic/claude-sonnet-4" }
const bedrockSonnet: ModelPickerRef = {
  providerID: "amazon-bedrock",
  modelID: "anthropic.claude-sonnet-4-20250514-v1:0",
}

function build(input: { recents?: ModelPickerRef[]; favorites?: ModelPickerRef[]; query?: string } = {}) {
  return buildModelPickerOptions({
    providers,
    connected: true,
    showExtra: true,
    ...input,
  })
}

const inCategory = (options: ReturnType<typeof build>, category: string) =>
  options.filter((option) => option.category === category).map((option) => option.modelID)

describe("model picker options", () => {
  test("matches colon-separated prefixes in model display names", () => {
    const options = buildModelPickerOptions({
      providers: [
        {
          id: "kilo",
          name: "Kilo Gateway",
          models: {
            "xai/grok-4.20": {
              id: "xai/grok-4.20",
              name: "SpaceXAI: Grok 4.20",
            },
          },
        },
      ],
      query: "SpaceX",
    })

    expect(options.map((option) => option.modelID)).toEqual(["xai/grok-4.20"])
  })

  test("keeps recommended Kilo models in their section after they are used", () => {
    const options = build({ recents: [sonnet45] })

    expect(inCategory(options, "Recent")).toEqual([sonnet45.modelID])
    expect(inCategory(options, RECOMMENDED_CATEGORY)).toEqual([sonnet45.modelID, sonnet4.modelID])
  })

  test("finds a recently used recommended Kilo model when filtering by provider name", () => {
    const options = build({ recents: [sonnet45], query: "kilo" })
    const recommended = inCategory(options, RECOMMENDED_CATEGORY)

    expect(recommended).toContain(sonnet45.modelID)
    expect(recommended).toContain(sonnet4.modelID)
    expect(inCategory(options, "Kilo Gateway")).toContain("openai/gpt-5")
  })

  test("filtering by provider name does not leak other providers", () => {
    const options = build({ query: "kilo" })

    expect(options.every((option) => option.providerID === "kilo")).toBe(true)
  })

  test("keeps the Kilo Gateway section populated after a Bedrock model is used", () => {
    const options = build({ recents: [bedrockSonnet] })

    expect(inCategory(options, "Recent")).toEqual([bedrockSonnet.modelID])
    expect(inCategory(options, "Kilo Gateway")).toEqual(["openai/gpt-5"])
    expect(inCategory(options, RECOMMENDED_CATEGORY)).toEqual([sonnet45.modelID, sonnet4.modelID])
    expect(inCategory(options, "Amazon Bedrock")).toEqual([bedrockSonnet.modelID])
  })

  test("still matches model titles", () => {
    const options = build({ query: "gpt 5" })

    expect(options.map((option) => option.modelID)).toEqual(["openai/gpt-5"])
  })

  test("favorites stay pinned to their own section", () => {
    const options = build({ favorites: [sonnet45] })

    expect(inCategory(options, "Favorites")).toEqual([sonnet45.modelID])
    expect(inCategory(options, RECOMMENDED_CATEGORY)).toEqual([sonnet4.modelID])
  })

  test("drops the extra sections when they are not rendered", () => {
    const options = buildModelPickerOptions({
      providers,
      connected: false,
      showExtra: false,
      recents: [sonnet45],
      favorites: [sonnet4],
      query: "sonnet",
    })

    expect(options.every((option) => option.category === undefined)).toBe(true)
    expect(options.map((option) => option.modelID)).toContain(sonnet45.modelID)
    expect(options.map((option) => option.modelID)).toContain(sonnet4.modelID)
  })
})
