import { describe, expect, it } from "bun:test"
import {
  initialSpeechToTextCatalog,
  reduceSpeechToTextCatalog,
  visibleSpeechToTextModels,
  type SpeechToTextCatalogMessage,
  type SpeechToTextCatalogState,
} from "../../webview-ui/src/components/speech-to-text/catalog-state"
import {
  canUseSpeechToText,
  hasExplicitSpeechToTextModel,
  selectedSpeechToTextModel,
} from "../../webview-ui/src/components/speech-to-text/availability"
import {
  DEFAULT_SPEECH_TO_TEXT_MODEL,
  SPEECH_TO_TEXT_MODELS,
  type SpeechToTextModelDef,
} from "../../src/speech-to-text/models"

const custom = (id: string): SpeechToTextModelDef => ({ id, label: id, provider: "127.0.0.1:8178" })

const push = (
  state: SpeechToTextCatalogState,
  message: { models: readonly SpeechToTextModelDef[]; source: "gateway" | "custom"; seq: number; epoch?: string },
) => reduceSpeechToTextCatalog(state, { epoch: "host-a", ...message })

const from = (message: {
  models: readonly SpeechToTextModelDef[]
  source: "gateway" | "custom"
  seq: number
  epoch?: string
}) => push(initialSpeechToTextCatalog, message)

describe("speech-to-text source switching", () => {
  it("drops the custom catalog when the source returns to Gateway", () => {
    const state = from({ models: [custom("small")], source: "custom", seq: 1 })

    expect(visibleSpeechToTextModels(state, "custom")).toEqual([custom("small")])
    const gateway = visibleSpeechToTextModels(state, "gateway")
    expect(gateway).toEqual(SPEECH_TO_TEXT_MODELS)
    // The stored custom ID is not a Gateway model, so the valid default is restored.
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_model: "small" } }, gateway)).toBe(
      DEFAULT_SPEECH_TO_TEXT_MODEL.id,
    )
  })

  it("does not show a Gateway catalog while a custom endpoint is active", () => {
    const state = from({ models: [...SPEECH_TO_TEXT_MODELS], source: "gateway", seq: 1 })
    const cfg = {
      experimental: { speech_to_text_base_url: "http://127.0.0.1:8178/v1", speech_to_text_model: "small" },
    }

    expect(visibleSpeechToTextModels(state, "custom")).toEqual([])
    // Only the explicit custom ID is used; no catalog entry is guessed.
    expect(selectedSpeechToTextModel(cfg, visibleSpeechToTextModels(state, "custom"))).toBe("small")
  })

  it("ignores an out-of-order reply when switching between custom endpoints", () => {
    const a = from({ models: [custom("a")], source: "custom", seq: 1 })
    const b = push(a, { models: [custom("b")], source: "custom", seq: 2 })
    const lateA = push(b, { models: [custom("a")], source: "custom", seq: 1 })

    expect(lateA).toBe(b)
    expect(visibleSpeechToTextModels(lateA, "custom")).toEqual([custom("b")])
  })

  it("ignores a delayed custom reply after the source switches to Gateway", () => {
    const customState = from({ models: [custom("small")], source: "custom", seq: 1 })
    const gatewayState = push(customState, { models: [...SPEECH_TO_TEXT_MODELS], source: "gateway", seq: 2 })
    const lateCustom = push(gatewayState, { models: [custom("small")], source: "custom", seq: 1 })

    expect(lateCustom).toBe(gatewayState)
    expect(visibleSpeechToTextModels(lateCustom, "gateway")).toEqual(SPEECH_TO_TEXT_MODELS)
  })

  it("accepts a fresh stream after the host restarts with a new epoch", () => {
    const stale = from({ models: [custom("small")], source: "custom", seq: 9 })
    const restarted = reduceSpeechToTextCatalog(stale, {
      models: [...SPEECH_TO_TEXT_MODELS],
      source: "gateway",
      epoch: "host-b",
      seq: 1,
    })

    expect(restarted.epoch).toBe("host-b")
    expect(visibleSpeechToTextModels(restarted, "gateway")).toEqual(SPEECH_TO_TEXT_MODELS)
  })

  it("ignores an untagged catalog message", () => {
    const state = from({ models: [custom("small")], source: "custom", seq: 1 })
    const untagged = push(state, { models: [...SPEECH_TO_TEXT_MODELS], source: "gateway", seq: 99, epoch: "" })

    expect(untagged).toBe(state)
  })

  it("requires an explicit model for a custom endpoint", () => {
    const noModel = { experimental: { speech_to_text_base_url: "http://127.0.0.1:8178/v1" } }
    const withModel = { experimental: { ...noModel.experimental, speech_to_text_model: "small" } }

    expect(hasExplicitSpeechToTextModel(noModel)).toBe(false)
    expect(canUseSpeechToText(noModel, {})).toBe(false)
    expect(selectedSpeechToTextModel(noModel)).toBe("")

    // A custom endpoint does not need Kilo sign-in, only its own model ID.
    expect(canUseSpeechToText(withModel, {})).toBe(true)
    expect(selectedSpeechToTextModel(withModel)).toBe("small")
  })

  it("keeps Gateway auth gating and replaces an unknown stored ID with the default", () => {
    expect(canUseSpeechToText({}, {})).toBe(false)
    expect(canUseSpeechToText({}, { kilo: "oauth" })).toBe(true)
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_model: "small" } })).toBe(
      DEFAULT_SPEECH_TO_TEXT_MODEL.id,
    )
  })

  it("uses a live Gateway model as the default when the static default is absent", () => {
    const live = [{ id: "fish-audio/transcribe-1", label: "Transcribe 1", provider: "Fish Audio" }]
    const state = from({ models: live, source: "gateway", seq: 1 })
    const models = visibleSpeechToTextModels(state, "gateway")

    expect(
      selectedSpeechToTextModel({ experimental: { speech_to_text_model: "nvidia/parakeet-tdt-0.6b-v3" } }, models),
    ).toBe("fish-audio/transcribe-1")
  })
})
