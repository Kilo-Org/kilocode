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

  test("keeps the chat variant when the command or agent model is the selected model", () => {
    expect(
      resolve({
        command: { model: "anthropic/claude-sonnet", agent: undefined, variant: undefined },
        agent: { model: undefined, variant: undefined },
        model,
        selected,
        input: "high",
        chat: model,
      }),
    ).toBe("high")

    expect(
      resolve({
        command: { model: undefined, agent: "reviewer", variant: undefined },
        agent: { model, variant: undefined },
        model,
        selected,
        input: "high",
        chat: model,
      }),
    ).toBe("high")
  })

  test("drops the chat variant when the command model differs from the selected model", () => {
    expect(
      resolve({
        command: { model: "anthropic/claude-sonnet", agent: undefined, variant: undefined },
        agent: { model: undefined, variant: undefined },
        model,
        selected,
        input: "high",
        chat: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-5") },
      }),
    ).toBeUndefined()
  })

  test("command variant still wins over the chat variant for the same model", () => {
    expect(
      resolve({
        command: { model: "anthropic/claude-sonnet", agent: undefined, variant: "max" },
        agent: { model: undefined, variant: undefined },
        model,
        selected: { variants: { high: {}, max: {} } },
        input: "high",
        chat: model,
      }),
    ).toBe("max")
  })
})
