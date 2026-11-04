import type { Target } from "../relay"
import { SpeechRpcError, callSpeechRpc } from "./rpc"
import { SPEECH_TO_TEXT_MODELS, type SpeechToTextModelDef } from "./models"

type CatalogModel = {
  id: string
  name: string
}

export type SpeechCatalogResult =
  | { ok: true; models: SpeechToTextModelDef[] }
  | { ok: false; error: string; unauthenticated?: boolean }

export async function fetchGatewayModels(
  server: Target,
  directory: string,
  signal?: AbortSignal,
): Promise<SpeechCatalogResult> {
  try {
    const output = await callSpeechRpc({ server, directory, method: "models.transcriptions", body: {}, signal })
    if (!Array.isArray(output)) return { ok: false, error: "Invalid speech-to-text model catalog" }
    const models = output.filter(isCatalogModel).map(toModel)
    return models.length > 0 ? { ok: true, models } : { ok: false, error: "Invalid speech-to-text model catalog" }
  } catch (err) {
    return {
      ok: false,
      error: message(err),
      unauthenticated: err instanceof SpeechRpcError && err.code === "unauthorized",
    }
  }
}

export async function isGatewaySignedIn(server: Target, directory: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const output = await callSpeechRpc({ server, directory, method: "authStatus", body: {}, signal })
    return !!output && typeof output === "object" && (output as { authenticated?: unknown }).authenticated === true
  } catch {
    return false
  }
}

/** The directory names a custom endpoint's provider, as v1 did when a model entry had no name. */
export function transcriptionModels(): readonly SpeechToTextModelDef[] {
  return SPEECH_TO_TEXT_MODELS
}

function isCatalogModel(value: unknown): value is CatalogModel {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).name === "string"
  )
}

function toModel(model: CatalogModel): SpeechToTextModelDef {
  const index = model.name.indexOf(":")
  const provider = index === -1 ? model.id.split("/", 1)[0] || "Kilo Gateway" : model.name.slice(0, index).trim()
  return {
    id: model.id,
    label: index === -1 ? model.name : model.name.slice(index + 1).trim(),
    provider,
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
