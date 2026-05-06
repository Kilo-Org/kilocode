// kilocode_change - new file
//
// Regression tests for https://github.com/Kilo-Org/kilocode/issues/9186
//
// When the user removes a model or a variant from a custom provider and saves,
// the removed entry must disappear from the config on disk. The save path
// relies on `null` sentinels being allowed in the Provider models record and
// in the Model variants record so that `mergeConfig` (merge + stripNulls) can
// delete them cleanly.

import { describe, expect, it } from "bun:test"
import * as Config from "../../src/config/config"
import { KilocodeConfig } from "../../src/kilocode/config/config"

describe("Config.Info — null sentinels for custom provider deletes", () => {
  it("accepts a null model value inside a provider", () => {
    const parsed = Config.Info.zod.safeParse({
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-gone": null,
          },
        },
      },
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts a null variant value inside a model", () => {
    const parsed = Config.Info.zod.safeParse({
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-1": {
              variants: {
                low: null,
              },
            },
          },
        },
      },
    })
    expect(parsed.success).toBe(true)
  })
})

describe("KilocodeConfig.mergeConfig — custom provider model/variant deletion", () => {
  it("drops a model from an existing provider when the patch sets it to null", () => {
    const existing = {
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-keep": { name: "Keep" },
            "model-gone": { name: "Gone" },
          },
        },
      },
    } as unknown as Config.Info
    const patch = {
      provider: {
        myprovider: {
          models: {
            "model-keep": { name: "Keep" },
            "model-gone": null,
          },
        },
      },
    } as unknown as Config.Info

    const merged = KilocodeConfig.mergeConfig(existing, patch)
    const models = (merged.provider as Record<string, { models: Record<string, unknown> }>).myprovider.models
    expect(models["model-keep"]).toBeDefined()
    expect("model-gone" in models).toBe(false)
  })

  it("drops a variant from an existing model when the patch sets it to null", () => {
    const existing = {
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-1": {
              name: "Model One",
              variants: {
                high: { reasoningEffort: "high" },
                low: { reasoningEffort: "low" },
              },
            },
          },
        },
      },
    } as unknown as Config.Info
    const patch = {
      provider: {
        myprovider: {
          models: {
            "model-1": {
              variants: {
                high: { reasoningEffort: "high" },
                low: null,
              },
            },
          },
        },
      },
    } as unknown as Config.Info

    const merged = KilocodeConfig.mergeConfig(existing, patch)
    const variants = (
      merged.provider as Record<string, { models: Record<string, { variants: Record<string, unknown> }> }>
    ).myprovider.models["model-1"].variants
    expect(variants.high).toBeDefined()
    expect("low" in variants).toBe(false)
  })
})
