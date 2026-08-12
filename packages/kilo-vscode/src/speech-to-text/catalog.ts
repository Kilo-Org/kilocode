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
  const index = model.name.indexOf(":")
  const provider = index === -1 ? model.id.split("/", 1)[0] || "Kilo Gateway" : model.name.slice(0, index).trim()
  return {
    id: model.id,
    label: index === -1 ? model.name : model.name.slice(index + 1).trim(),
    provider,
  }
}
