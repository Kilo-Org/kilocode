import { expect, test } from "bun:test"
import { ProviderModels } from "../../../src/kilocode/config/provider-models"

test("skips malformed models without dropping valid siblings", () => {
  const result = ProviderModels.sanitize(
    {
      provider: {
        litellm: {
          models: {
            good: { limit: { context: 128000, output: 8192 } },
            bad: { limit: { output: 8192 } },
            removed: null,
          },
        },
      },
    },
    "kilo.json",
  )

  expect(result.config).toEqual({
    provider: {
      litellm: {
        models: {
          good: { limit: { context: 128000, output: 8192 } },
          removed: null,
        },
      },
    },
  })
  expect(result.warnings).toEqual([
    {
      path: "kilo.json",
      message: "Skipped invalid model configuration at provider.litellm.models.bad",
      detail: "The remaining models for this provider were kept.",
    },
  ])
})

test("keeps a model whose ID is __proto__ without changing the model map prototype", () => {
  const input = JSON.parse(
    '{"provider":{"litellm":{"models":{"__proto__":{"limit":{"context":128000,"output":8192}}}}}}',
  )
  const result = ProviderModels.sanitize(input, "kilo.json")
  const config = result.config as {
    provider: { litellm: { models: Record<string, unknown> } }
  }
  const models = config.provider.litellm.models

  expect(Object.hasOwn(models, "__proto__")).toBe(true)
  expect(models.__proto__).toEqual({ limit: { context: 128000, output: 8192 } })
  expect(Object.getPrototypeOf(models)).toBe(Object.prototype)
  expect(result.warnings).toEqual([])
})
