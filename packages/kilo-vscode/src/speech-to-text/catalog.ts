import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getErrorMessage } from "../kilo-provider-utils"
import { type SpeechToTextModelDef } from "./models"
import { hasCustomSource, sourceHeaders, sourceUrl, type SpeechToTextSource } from "./source"

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
  source?: SpeechToTextSource,
): Promise<SpeechToTextCatalogResult> {
  if (hasCustomSource(source)) return await fetchCustomModels(source, signal)

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

async function fetchCustomModels(source: SpeechToTextSource, signal?: AbortSignal): Promise<SpeechToTextCatalogResult> {
  try {
    const res = await fetch(sourceUrl(source, "models"), { signal, headers: sourceHeaders(source) })
    if (!res.ok) return fail(`Failed to fetch speech-to-text models from ${source.baseUrl} (HTTP ${res.status})`)

    const models = parseCustomCatalog(await res.json(), source.baseUrl)
    if (!models) return fail(`Invalid speech-to-text model catalog from ${source.baseUrl}`)
    return { ok: true, models }
  } catch (err) {
    return fail(getErrorMessage(err))
  }
}

export function parseCustomCatalog(body: unknown, origin: string): SpeechToTextModelDef[] | undefined {
  const list = Array.isArray(body) ? body : data(body)
  if (!list) return undefined

  const provider = label(origin)
  const models = list.filter(hasId).map((model) => ({
    id: model.id,
    label: typeof model.name === "string" && model.name ? model.name : model.id,
    provider,
  }))
  return models.length > 0 ? models : undefined
}

function data(body: unknown): unknown[] | undefined {
  const list = (body as { data?: unknown } | null)?.data
  return Array.isArray(list) ? list : undefined
}

function label(origin: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(origin)
  return match?.[1] ?? origin ?? "Custom"
}

function hasId(value: unknown): value is { id: string; name?: unknown } {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string"
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
