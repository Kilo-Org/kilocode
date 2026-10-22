import { SPEECH_TO_TEXT_MODELS, type SpeechToTextModelDef } from "../../../../src/speech-to-text/models"

export type SpeechToTextSourceKind = "gateway" | "custom"

export type SpeechToTextCatalogState = {
  readonly models: readonly SpeechToTextModelDef[]
  readonly source: SpeechToTextSourceKind
  // Producer instance id, so a restarted host is treated as a new stream.
  readonly epoch: string
  readonly seq: number
}

export type SpeechToTextCatalogMessage = {
  readonly models: readonly SpeechToTextModelDef[]
  readonly source: SpeechToTextSourceKind
  readonly epoch: string
  readonly seq: number
}

// The Gateway catalog starts from the static fallback so Gateway mode never shows
// a model from a previous custom source while its live catalog is still loading.
export const initialSpeechToTextCatalog: SpeechToTextCatalogState = {
  models: SPEECH_TO_TEXT_MODELS,
  source: "gateway",
  epoch: "",
  seq: 0,
}

export function reduceSpeechToTextCatalog(
  state: SpeechToTextCatalogState,
  message: SpeechToTextCatalogMessage,
): SpeechToTextCatalogState {
  // An untagged message cannot be ordered against tagged ones, so never trust it.
  if (!message.epoch) return state
  // A different producer, for example a restarted host, starts a new stream.
  if (message.epoch !== state.epoch) return { ...message }
  // Older messages are ignored so a slow reply cannot overwrite a newer catalog.
  if (!Number.isFinite(message.seq) || message.seq <= state.seq) return state
  return { ...message }
}

export function visibleSpeechToTextModels(
  state: SpeechToTextCatalogState,
  source: SpeechToTextSourceKind,
): readonly SpeechToTextModelDef[] {
  if (state.source === source) return state.models
  // Gateway mode falls back to the static Gateway list; custom mode never guesses
  // a custom catalog and relies on the explicit model ID instead.
  return source === "gateway" ? SPEECH_TO_TEXT_MODELS : []
}
