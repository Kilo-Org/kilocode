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
