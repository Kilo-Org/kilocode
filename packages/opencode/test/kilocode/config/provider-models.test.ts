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

test("warns on unknown model fields while keeping the model untouched", () => {
  const model = {
    name: "vision-model",
    attachment: true,
    capabilities: { attachment: true, input: { image: true } },
  }
  const result = ProviderModels.sanitize(
    {
      provider: {
        "issue-15790": {
          npm: "@ai-sdk/openai-compatible",
          models: { "vision-model": model },
        },
      },
    },
    "kilo.json",
  )
  const config = result.config as {
    provider: { "issue-15790": { models: Record<string, unknown> } }
  }

  // The field is not deleted or rewritten, only surfaced as a warning.
  expect(config.provider["issue-15790"].models["vision-model"]).toBe(model)
  expect(result.warnings).toEqual([
    {
      path: "kilo.json",
      message: 'Unknown field "capabilities" at provider.issue-15790.models.vision-model is ignored',
      detail:
        'Declare model capabilities with the model-level "attachment" boolean and "modalities.input"/"modalities.output" arrays; a wire-shape "capabilities" object is not valid configuration.',
    },
  ])
})

test("reports both unknown-field and malformed-model warnings in the same provider", () => {
  const result = ProviderModels.sanitize(
    {
      provider: {
        litellm: {
          models: {
            good: {
              name: "good",
              attachment: true,
              capabilities: { input: { image: true } },
            },
            bad: { limit: { output: 8192 } },
          },
        },
      },
    },
    "kilo.json",
  )

  expect(result.warnings).toEqual([
    {
      path: "kilo.json",
      message: 'Unknown field "capabilities" at provider.litellm.models.good is ignored',
      detail:
        'Declare model capabilities with the model-level "attachment" boolean and "modalities.input"/"modalities.output" arrays; a wire-shape "capabilities" object is not valid configuration.',
    },
    {
      path: "kilo.json",
      message: "Skipped invalid model configuration at provider.litellm.models.bad",
      detail: "The remaining models for this provider were kept.",
    },
  ])
  const config = result.config as {
    provider: { litellm: { models: Record<string, unknown> } }
  }
  expect(Object.keys(config.provider.litellm.models)).toEqual(["good"])
})

test("aggregates unknown model fields into a single warning per model", () => {
  const result = ProviderModels.sanitize(
    {
      provider: {
        "issue-15790": {
          npm: "@ai-sdk/openai-compatible",
          models: {
            mixed: {
              name: "mixed",
              attachment: true,
              capabilities: { input: { image: true } },
              extra: 1,
            },
            plain: {
              name: "plain",
              widget: true,
            },
          },
        },
      },
    },
    "kilo.json",
  )

  expect(result.warnings).toEqual([
    {
      path: "kilo.json",
      message:
        'Unknown fields "capabilities", "extra" at provider.issue-15790.models.mixed are ignored',
      detail:
        'Declare model capabilities with the model-level "attachment" boolean and "modalities.input"/"modalities.output" arrays; a wire-shape "capabilities" object is not valid configuration.',
    },
    {
      path: "kilo.json",
      message: 'Unknown field "widget" at provider.issue-15790.models.plain is ignored',
      detail: "Only fields declared by the provider model configuration schema are applied to this model.",
    },
  ])
})

test("does not warn about unknown fields on null model sentinels", () => {
  const result = ProviderModels.sanitize(
    {
      provider: {
        litellm: {
          models: { removed: null },
        },
      },
    },
    "kilo.json",
  )

  expect(result.warnings).toEqual([])
})
