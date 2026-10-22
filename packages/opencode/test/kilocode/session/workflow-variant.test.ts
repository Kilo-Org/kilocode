import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { resolve } from "../../../src/kilocode/session/workflow-variant"

const selected = { variants: { high: {} } }
const model = { providerID: ProviderV2.ID.make("anthropic"), modelID: ModelV2.ID.make("claude-sonnet") }

describe("workflow variant resolution", () => {
  test("prefers the command variant", () => {
    expect(
      resolve({
        command: { model: "anthropic/claude-sonnet", agent: undefined, variant: "high" },
        agent: { model: undefined, variant: undefined },
        model,
        selected,
        input: "high",
      }),
    ).toBe("high")
  })

  test("uses an agent variant only for the agent model", () => {
    expect(
      resolve({
        command: { model: undefined, agent: "reviewer", variant: undefined },
        agent: { model, variant: "high" },
        model,
        selected,
      }),
    ).toBe("high")

    expect(
      resolve({
        command: { model: undefined, agent: "reviewer", variant: undefined },
        agent: { model, variant: "high" },
        model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-5") },
        selected,
      }),
    ).toBeUndefined()
  })

  test("uses chat variant when an agent does not select a model", () => {
    expect(
      resolve({
        command: { model: undefined, agent: undefined, variant: undefined },
        agent: { model: undefined, variant: undefined },
        model,
        selected,
        input: "high",
      }),
    ).toBe("high")

    expect(
      resolve({
        command: { model: "anthropic/claude-sonnet", agent: undefined, variant: undefined },
        agent: { model: undefined, variant: undefined },
        model,
        selected,
        input: "high",
      }),
    ).toBeUndefined()

    expect(
      resolve({
        command: { model: undefined, agent: "reviewer", variant: undefined },
        agent: { model: undefined, variant: undefined },
        model,
        selected,
        input: "high",
      }),
    ).toBe("high")
  })
})
