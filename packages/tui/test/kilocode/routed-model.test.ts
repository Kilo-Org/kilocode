import { expect, test } from "bun:test"
import type { JsonValue, SessionMessageAssistant } from "@opencode/client"
import { groupRoutedModelLabels, routedModel, routedModelLabel } from "../../src/kilocode/routed-model"
import { contextUsage } from "../../src/util/session"
import { catalogModel } from "../mini/fixture/catalog"

const model = { providerID: "kilo", id: "kilo-auto/free", variant: "high" }

test("uses only a Kilo assistant's own route without changing its requested model", () => {
  const message = { model, native: { kilo: { routedModelID: " openai/gpt-5.5 ", vercelID: "request-1" } } }
  expect(routedModel(message)).toEqual({ ...model, id: "openai/gpt-5.5" })
  expect(message.model).toBe(model)
  expect(message.model.id).toBe("kilo-auto/free")
  expect(routedModel({ ...message, model: { ...model, providerID: "openrouter" } })).toBeUndefined()
  const invalidRoutes: JsonValue[] = [null, 42, {}, "", "  ", model.id]
  for (const routedModelID of invalidRoutes) {
    expect(routedModel({ model, native: { kilo: { routedModelID } } })).toBeUndefined()
  }
  const invalidNamespaces: JsonValue[] = [null, 42, [], "not-a-namespace"]
  for (const kilo of invalidNamespaces) {
    expect(routedModel({ model, native: { kilo, routedModelID: "ignored-flat-route" } })).toBeUndefined()
  }
  expect(routedModel({ model, native: { routedModelID: "ignored-flat-route" } })).toBeUndefined()
})

test("matches main's compact route labels and falls back to the returned ID", () => {
  expect(routedModelLabel({ model, native: { kilo: { routedModelID: "openai/gpt-5.5-2026-04-23" } } }, [])).toBe(
    "gpt-5.5",
  )
  expect(
    routedModelLabel({ model, native: { kilo: { routedModelID: "moonshotai/kimi-k2.7-code-20260612" } } }, []),
  ).toBe("kimi-k2.7-code")
  expect(
    routedModelLabel({ model, native: { kilo: { routedModelID: "qwen/qwen3.7-plus-20261001" } } }, [
      { providerID: "kilo", id: "qwen/qwen3.7-plus", name: "Qwen: Qwen3.7 Plus (20% off)" },
    ]),
  ).toBe("Qwen 3.7 Plus")
  expect(
    routedModelLabel(
      { model: { ...model, id: "direct-model" }, native: { kilo: { routedModelID: "direct-model-version" } } },
      [],
    ),
  ).toBeUndefined()
})

test("context usage uses the routed catalog limit and falls back to the requested model", () => {
  const message: SessionMessageAssistant = {
    type: "assistant",
    id: "routed",
    agent: "build",
    model,
    native: { kilo: { routedModelID: "openai/gpt-5.5" } },
    content: [],
    tokens: { input: 8_000, output: 1_000, reasoning: 500, cache: { read: 500, write: 0 } },
    time: { created: 0, completed: 1 },
  }
  const models = [
    catalogModel({ providerID: "kilo", id: model.id, context: 100_000 }),
    catalogModel({ providerID: "kilo", id: "openai/gpt-5.5", context: 200_000 }),
  ]
  expect(contextUsage([message], models)).toEqual({ tokens: 10_000, percent: 5 })
  expect(contextUsage([message], models.slice(0, 1))).toEqual({ tokens: 10_000, percent: 10 })
  expect(contextUsage([{ ...message, native: undefined }], models)).toEqual({ tokens: 10_000, percent: 10 })
  expect(
    contextUsage(
      [{ ...message, model: { ...model, providerID: "other" } }],
      [catalogModel({ providerID: "other", id: model.id, context: 100_000 })],
    ),
  ).toEqual({ tokens: 10_000, percent: 10 })
  const other = { ...message, id: "second", native: { kilo: { routedModelID: "anthropic/claude-sonnet-4.6" } } }
  expect(
    groupRoutedModelLabels(
      {
        type: "group",
        kind: "reasoning",
        size: 3,
        children: [message.id, message.id, other.id].map((messageID) => ({
          type: "entry",
          size: 1,
          entry: { type: "part", ref: { messageID, partID: "reasoning:0" } },
        })),
      },
      (id) => (id === message.id ? message : other),
      models,
    ),
  ).toEqual(["gpt-5.5", "claude-sonnet-4.6"])
})
