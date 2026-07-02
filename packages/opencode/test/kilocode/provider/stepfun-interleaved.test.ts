import { expect, test } from "bun:test"
import { Effect } from "effect"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "../../../src/provider/provider"
import { ProviderID } from "../../../src/provider/schema"
import { testEffect } from "../../lib/effect"

const it = testEffect(Provider.defaultLayer)

const base = (id: string): ModelsDev.Model => ({
  id,
  name: id,
  release_date: "2026-01-01",
  attachment: false,
  reasoning: true,
  temperature: true,
  tool_call: true,
  limit: {
    context: 128000,
    output: 8192,
  },
})

test("StepFun catalog models default to interleaved reasoning_content", () => {
  const provider = Provider.fromModelsDevProvider({
    id: "stepfun",
    name: "StepFun",
    env: ["STEPFUN_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.stepfun.com/v1",
    models: {
      "step-3.5-flash": base("step-3.5-flash"),
    },
  })

  expect(provider.models["step-3.5-flash"].capabilities.interleaved).toEqual({
    field: "reasoning_content",
  })
})

test("StepFun provider does not default when model ID does not include step", () => {
  const provider = Provider.fromModelsDevProvider({
    id: "stepfun",
    name: "StepFun",
    env: ["STEPFUN_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.stepfun.com/v1",
    models: {
      custom: {
        ...base("custom"),
        name: "Custom Model",
      },
    },
  })

  expect(provider.models["custom"].capabilities.interleaved).toBe(false)
})

test("catalog model IDs containing step default to interleaved reasoning_content", () => {
  const provider = Provider.fromModelsDevProvider({
    id: "custom-provider",
    name: "Custom Provider",
    env: ["CUSTOM_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.custom.com/v1",
    models: {
      space: base("step 3.5 flash"),
      hyphen: base("step-3.5-flash"),
      dot: base("step.3.5.flash"),
      underscore: base("step_3_5_flash"),
    },
  })

  for (const model of Object.values(provider.models)) {
    expect(model.capabilities.interleaved).toEqual({
      field: "reasoning_content",
    })
  }
})

test("catalog model IDs containing step do not default for non-openai-compatible providers", () => {
  const provider = Provider.fromModelsDevProvider({
    id: "custom-provider",
    name: "Custom Provider",
    env: ["CUSTOM_API_KEY"],
    npm: "@kilocode/kilo-gateway",
    api: "https://api.custom.com/v1",
    models: {
      custom: base("step-3.5-flash"),
    },
  })

  expect(provider.models["custom"].capabilities.interleaved).toBe(false)
})

it.instance(
  "configured StepFun and step model IDs default to interleaved reasoning_content",
  Effect.gen(function* () {
    const providers = yield* Provider.use.list()
    const stepfun = providers[ProviderID.make("stepfun")].models["step-custom"]
    const custom = providers[ProviderID.make("custom-provider")].models["custom-step"]

    expect(stepfun.capabilities.interleaved).toEqual({
      field: "reasoning_content",
    })
    expect(custom.capabilities.interleaved).toEqual({
      field: "reasoning_content",
    })
  }),
  {
    config: {
      provider: {
        stepfun: {
          name: "StepFun",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.stepfun.com/v1",
          models: {
            "step-custom": { name: "Step Custom" },
          },
          options: { apiKey: "test-key" },
        },
        "custom-provider": {
          name: "Custom Provider",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "custom-step": { id: "step-3.5-flash", name: "Custom Alias" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)
