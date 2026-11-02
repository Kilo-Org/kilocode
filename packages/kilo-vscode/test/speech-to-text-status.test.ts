import { describe, expect, it } from "bun:test"
import { resolveSpeechStatus } from "../src/speech-to-text/status"
import { SPEECH_TO_TEXT_MODELS } from "../src/speech-to-text/models"
import { emptySpeechStatus, selectedSpeechToTextModel } from "../webview-ui/src/components/speech-to-text/availability"

describe("resolveSpeechStatus", () => {
  it("enables Gateway speech for a signed-in account and keeps a listed model", () => {
    expect(
      resolveSpeechStatus({
        settings: { model: "openai/whisper-1" },
        remote: false,
        signedIn: true,
        models: SPEECH_TO_TEXT_MODELS,
      }),
    ).toMatchObject({
      enabled: true,
      remote: false,
      signedIn: true,
      source: "gateway",
      model: "openai/whisper-1",
    })
  })

  it("falls back to the first catalog model when the stored Gateway model left the catalog", () => {
    expect(
      resolveSpeechStatus({
        settings: { model: "gone/model" },
        remote: false,
        signedIn: true,
        models: [{ id: "live/model", label: "Live", provider: "Test" }],
      }).model,
    ).toBe("live/model")
  })

  it("keeps the static Gateway fallback when the catalog fails", () => {
    const status = resolveSpeechStatus({
      settings: {},
      remote: false,
      signedIn: true,
      models: SPEECH_TO_TEXT_MODELS,
      catalogError: "network",
    })
    expect(status.enabled).toBe(true)
    expect(status.model).toBe(SPEECH_TO_TEXT_MODELS[0]!.id)
    expect(status.catalogError).toBe("network")
  })

  it("hides the microphone when signed out and in remote windows", () => {
    expect(resolveSpeechStatus({ settings: {}, remote: false, signedIn: false, models: SPEECH_TO_TEXT_MODELS }).enabled).toBe(false)
    expect(resolveSpeechStatus({ settings: {}, remote: true, signedIn: true, models: SPEECH_TO_TEXT_MODELS }).enabled).toBe(false)
  })

  it("requires an explicit model for a custom endpoint", () => {
    const base = { baseUrl: "https://speech.test/v1", apiKey: "key" }
    expect(resolveSpeechStatus({ settings: base, remote: false, signedIn: false, models: [] })).toMatchObject({
      enabled: false,
      source: "custom",
      model: "",
    })
    expect(resolveSpeechStatus({ settings: { ...base, model: "whisper-1" }, remote: false, signedIn: false, models: [] })).toMatchObject({
      enabled: true,
      source: "custom",
      model: "whisper-1",
      models: [],
    })
    expect(
      resolveSpeechStatus({ settings: { ...base, model: "whisper-1" }, remote: true, signedIn: false, models: [] }).enabled,
    ).toBe(false)
  })
})

describe("selectedSpeechToTextModel", () => {
  it("uses the explicit custom model and hides availability without one", () => {
    expect(
      selectedSpeechToTextModel({
        experimental: { speech_to_text_base_url: "http://x", speech_to_text_model: "whisper-1" },
      }),
    ).toBe("whisper-1")
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_base_url: "http://x" } })).toBe("")
  })

  it("keeps a gateway model that the live catalog lists and falls back to the first", () => {
    const models = [
      { id: "live/model", label: "Live", provider: "Test" },
      { id: "other/model", label: "Other", provider: "Test" },
    ]
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_model: "other/model" } }, models)).toBe(
      "other/model",
    )
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_model: "gone/model" } }, models)).toBe("live/model")
  })

  it("starts unavailable until the host answers", () => {
    expect(emptySpeechStatus()).toMatchObject({ enabled: false, source: "gateway", settings: {} })
  })
})
