import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { groupModelsByProvider, modelUsage } from "../../src/kilocode/plugins/model-usage"

const step = (input: {
  id: string
  providerID: string
  model: string
  route?: string
  cost?: number
  tokens?: boolean
}): SessionMessageInfo => ({
  type: "assistant",
  id: input.id,
  agent: "build",
  model: { providerID: input.providerID, id: input.model },
  ...(input.route ? { native: { kilo: { routedModelID: input.route } } } : {}),
  content: [],
  ...(input.cost === undefined ? {} : { cost: input.cost }),
  ...(input.tokens === false
    ? {}
    : { tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 300, write: 10 } } }),
  time: { created: 0, completed: 1 },
})

describe("modelUsage", () => {
  test("counts each completed step under its routed model, sorted by cost", () => {
    const usage = modelUsage([
      { type: "user", id: "msg_user", text: "hi", time: { created: 0 } },
      step({
        id: "a",
        providerID: "kilo",
        model: "kilo-auto/frontier",
        route: "anthropic/claude-sonnet-4.6",
        cost: 0.2,
      }),
      step({
        id: "b",
        providerID: "kilo",
        model: "kilo-auto/frontier",
        route: "anthropic/claude-sonnet-4.6",
        cost: 0.1,
      }),
      step({ id: "c", providerID: "kilo", model: "kilo-auto/frontier", route: "openai/gpt-5.4", cost: 0.4 }),
      step({ id: "d", providerID: "openai", model: "gpt-5.4", cost: 0.05 }),
      // A step without usage is still running, and v1 counted only finished steps.
      step({ id: "e", providerID: "openai", model: "gpt-5.4", cost: 1, tokens: false }),
    ])
    expect(usage.models.map((row) => [row.providerID, row.modelID, row.steps, Number(row.cost.toFixed(2))])).toEqual([
      ["kilo", "openai/gpt-5.4", 1, 0.4],
      ["kilo", "anthropic/claude-sonnet-4.6", 2, 0.3],
      ["openai", "gpt-5.4", 1, 0.05],
    ])
    expect(usage.models[1].tokens).toEqual({ input: 200, output: 40, reasoning: 10, cache: { read: 600, write: 20 } })
    expect(usage.totals.steps).toBe(4)
    expect(usage.totals.cost).toBeCloseTo(0.75)
    expect(usage.totals.tokens.cache.read).toBe(1200)
  })

  test("ties sort by provider and model, and a missing cost counts as zero", () => {
    const usage = modelUsage([
      step({ id: "a", providerID: "zai", model: "glm-5" }),
      step({ id: "b", providerID: "anthropic", model: "opus" }),
      step({ id: "c", providerID: "anthropic", model: "haiku" }),
    ])
    expect(usage.models.map((row) => `${row.providerID}/${row.modelID}`)).toEqual([
      "anthropic/haiku",
      "anthropic/opus",
      "zai/glm-5",
    ])
    expect(usage.totals.cost).toBe(0)
  })

  test("groups rows by provider in row order with provider names", () => {
    const usage = modelUsage([
      step({ id: "a", providerID: "kilo", model: "a", cost: 3 }),
      step({ id: "b", providerID: "openai", model: "b", cost: 2 }),
      step({ id: "c", providerID: "kilo", model: "c", cost: 1 }),
    ])
    expect(
      groupModelsByProvider(usage.models, [{ id: "kilo", name: "Kilo Gateway" }]).map((group) => [
        group.providerName,
        group.models.map((row) => row.modelID),
      ]),
    ).toEqual([
      ["Kilo Gateway", ["a", "c"]],
      ["openai", ["b"]],
    ])
  })
})
