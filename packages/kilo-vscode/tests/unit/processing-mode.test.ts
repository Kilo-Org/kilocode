import { describe, expect, it } from "bun:test"
import { createSignal } from "solid-js"
import { supportsFlex } from "../../webview-ui/src/context/processing-mode"
import { createSessionProcessingMode } from "../../webview-ui/src/context/session-processing-mode"
import type { ModelSelection, Provider } from "../../webview-ui/src/types/messages"

const selection: ModelSelection = { providerID: "openai", modelID: "gpt-5.6-luna" }
const model = { id: selection.modelID, name: "GPT-5.6 Sol", api: { npm: "@ai-sdk/openai", url: "" } }

const provider = (options: Provider["options"] = {}): Provider => ({
  id: "openai",
  name: "OpenAI",
  source: "env",
  options,
  models: { [model.id]: model },
})

describe("processing mode eligibility", () => {
  it("allows the built-in OpenAI endpoint when its catalog URL is empty", () => {
    expect(supportsFlex({ openai: provider() }, { openai: "api" }, selection)).toBe(true)
  })

  it("rejects OAuth and custom endpoints", () => {
    expect(supportsFlex({ openai: provider() }, { openai: "oauth" }, selection)).toBe(false)
    expect(
      supportsFlex({ openai: provider({ baseURL: "https://proxy.example/v1" }) }, { openai: "api" }, selection),
    ).toBe(false)
  })

  it("does not leak draft Flex into another session", () => {
    const [session] = createSignal<string | undefined>()
    const state = createSessionProcessingMode({
      session,
      selected: () => selection,
      providers: () => ({ openai: provider() }),
      authStates: () => ({ openai: "api" }),
    })

    state.select("flex")
    expect(state.current("other-session")).toBe("standard")
  })
})
