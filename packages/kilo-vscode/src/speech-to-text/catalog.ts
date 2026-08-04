import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getErrorMessage } from "../kilo-provider-utils"
import { type SpeechToTextModelDef } from "./models"

const PATH = "/kilo/models/transcriptions"

type CatalogModel = {
  id: string
  name: string
}

export type SpeechToTextCatalogResult = { ok: true; models: SpeechToTextModelDef[] } | { ok: false; error: string }

export async function fetchSpeechToTextModels(
  connection: KiloConnectionService,
  dir: string,
  signal?: AbortSignal,
): Promise<SpeechToTextCatalogResult> {
  const cfg = connection.getServerConfig()
  if (!cfg) return fail("Not connected to the Kilo backend")

  const auth = Buffer.from(`kilo:${cfg.password}`).toString("base64")
  const url = new URL(PATH, cfg.baseUrl)
  if (dir) url.searchParams.set("directory", dir)

  try {
    const res = await fetch(url, { signal, headers: { Authorization: `Basic ${auth}` } })
    if (!res.ok) return fail(`Failed to fetch speech-to-text models (HTTP ${res.status})`)

    const models = parseSpeechToTextCatalog(await res.json())
    if (!models) return fail("Invalid speech-to-text model catalog")
    return { ok: true, models }
  } catch (err) {
    return fail(getErrorMessage(err))
  }
}

function fail(error: string): SpeechToTextCatalogResult {
  return { ok: false, error }
}

export function parseSpeechToTextCatalog(body: unknown): SpeechToTextModelDef[] | undefined {
  if (!Array.isArray(body)) return undefined
  const models = body.filter(isCatalogModel).map(toModel)
  return models.length > 0 ? models : undefined
}

function isCatalogModel(value: unknown): value is CatalogModel {
  if (!value || typeof value !== "object") return false
  const model = value as Record<string, unknown>
  return typeof model.id === "string" && typeof model.name === "string"
}

function toModel(model: CatalogModel): SpeechToTextModelDef {
  const provider = model.name.split(":", 1)[0]?.trim() || model.id.split("/", 1)[0] || "Kilo Gateway"
  return {
    id: model.id,
    label: model.name.includes(":") ? model.name.slice(model.name.indexOf(":") + 1).trim() : model.name,
    provider,
    ...(isVerbatim(model.id) ? { verbatim: true } : {}),
  }
}

function isVerbatim(id: string): boolean {
  return id === "openai/gpt-4o-mini-transcribe" || id === "openai/gpt-4o-transcribe"
}
