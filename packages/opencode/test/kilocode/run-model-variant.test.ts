import { describe, expect, test } from "bun:test"
import {
  createVariantSelection,
  resolveConfiguredVariant,
  saveVariantConfig,
} from "@/kilocode/cli/cmd/run/model-variant"

const model = {
  providerID: "openai",
  modelID: "gpt-5",
}

const agents = [
  {
    name: "build",
    variant: "high",
  },
  {
    name: "review",
    model,
    variant: "max",
  },
]

describe("run model variant", () => {
  test("resolves the explicitly selected agent", () => {
    expect(
      resolveConfiguredVariant({
        agents,
        agent: "review",
        model,
        variants: ["high", "max"],
      }),
    ).toEqual({ agent: "review", variant: "max" })
  })

  test("resolves the first agent when no agent is selected", () => {
    expect(
      resolveConfiguredVariant({
        agents,
        agent: undefined,
        model,
        variants: ["high", "max"],
      }),
    ).toEqual({ agent: "build", variant: "high" })
  })

  test("applies an unpinned agent variant to the selected model", () => {
    expect(
      resolveConfiguredVariant({
        agents: [{ name: "build", variant: "high" }],
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude" },
        variants: ["high"],
      }),
    ).toEqual({ agent: "build", variant: "high" })
  })

  test("ignores a configured variant when the pinned model differs", () => {
    expect(
      resolveConfiguredVariant({
        agents,
        agent: "review",
        model: { providerID: "anthropic", modelID: "claude" },
        variants: ["high", "max"],
      }),
    ).toEqual({ agent: "review", variant: undefined })
  })

  test("ignores an unsupported configured variant", () => {
    expect(
      resolveConfiguredVariant({
        agents,
        agent: "review",
        model,
        variants: ["high"],
      }),
    ).toEqual({ agent: "review", variant: undefined })
  })

  test("preserves configured default as prompt state", () => {
    expect(
      resolveConfiguredVariant({
        agents: [{ name: "build", variant: "default" }],
        agent: "build",
        model,
        variants: ["high", "max"],
      }),
    ).toEqual({ agent: "build", variant: "default" })
  })

  test("maps an explicit Default choice to prompt and config default", () => {
    expect(createVariantSelection("build", undefined)).toEqual({
      display: undefined,
      prompt: "default",
      config: {
        agent: {
          build: {
            variant: "default",
          },
        },
      },
    })
  })

  test("preserves a provider variant for display prompt and config", () => {
    expect(createVariantSelection("review", "max")).toEqual({
      display: "max",
      prompt: "max",
      config: {
        agent: {
          review: {
            variant: "max",
          },
        },
      },
    })
  })

  test("returns the saved selection after the config update succeeds", async () => {
    const writes: unknown[] = []
    const selection = await saveVariantConfig({
      agent: "build",
      variant: undefined,
      update: async (config) => {
        writes.push(config)
      },
    })

    expect(selection?.prompt).toBe("default")
    expect(writes).toEqual([selection?.config])
  })

  test("does not return a selection when the config update fails", async () => {
    const selection = await saveVariantConfig({
      agent: "build",
      variant: "high",
      update: () => Promise.reject(new Error("write failed")),
    })

    expect(selection).toBeUndefined()
  })
})
