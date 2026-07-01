import { describe, expect, test } from "bun:test"
import {
  resolveAgentVariant,
  resolveConfiguredVariant,
  resolvePromptVariant,
  resolveRuntimeVariant,
  resolveSelectedVariant,
} from "../../src/kilocode/cli/cmd/tui/model-variant"

const vars = {
  high: {},
  max: {},
}

describe("model variant resolution", () => {
  test("uses runtime override when supported", () => {
    expect(resolveSelectedVariant({ override: "high", config: "max", variants: vars })).toBe("high")
  })

  test("explicit default override suppresses config variant", () => {
    expect(resolveSelectedVariant({ override: "default", config: "max", variants: vars })).toBe("default")
  })

  test("valid runtime override beats config default sentinel", () => {
    expect(resolveSelectedVariant({ override: "high", config: "default", variants: vars })).toBe("high")
  })

  test("falls back to config variant when override is absent", () => {
    expect(resolveSelectedVariant({ config: "max", variants: vars })).toBe("max")
  })

  test("preserves config default sentinel in selected state", () => {
    expect(resolveSelectedVariant({ config: "default", variants: vars })).toBe("default")
  })

  test("falls back to config variant when override is unsupported", () => {
    expect(resolveSelectedVariant({ override: "low", config: "max", variants: vars })).toBe("max")
  })

  test("ignores unsupported configured variant", () => {
    expect(resolveConfiguredVariant({ variant: "low", variants: vars })).toBeUndefined()
  })

  test("reserves configured default sentinel even when variants include default", () => {
    expect(resolveConfiguredVariant({ variant: "default", variants: { ...vars, default: {} } })).toBeUndefined()
  })

  test("applies agent variant when no config model is pinned", () => {
    expect(
      resolveAgentVariant({
        current: { providerID: "test", modelID: "saved-model" },
        variant: "max",
        variants: vars,
      }),
    ).toBe("max")
  })

  test("does not apply agent variant when a different config model is pinned", () => {
    expect(
      resolveAgentVariant({
        current: { providerID: "test", modelID: "saved-model" },
        config: { providerID: "test", modelID: "config-model" },
        variant: "max",
        variants: vars,
      }),
    ).toBeUndefined()
  })

  test("explicit prompt default suppresses configured agent variant", () => {
    expect(
      resolvePromptVariant({
        override: "default",
        current: { providerID: "test", modelID: "saved-model" },
        variant: "max",
        variants: vars,
      }),
    ).toBe("default")
  })

  test("configured prompt default is not a prompt override", () => {
    expect(
      resolvePromptVariant({
        override: undefined,
        current: { providerID: "test", modelID: "saved-model" },
        variant: "default",
        variants: { ...vars, default: {} },
      }),
    ).toBeUndefined()
  })

  test("runtime variant treats default sentinel as base options", () => {
    expect(resolveRuntimeVariant("default")).toBeUndefined()
    expect(resolveRuntimeVariant("max")).toBe("max")
  })
})
