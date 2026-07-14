import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getErrorMessage } from "../kilo-provider-utils"

const PATH = "/kilo/models/images"

export type ImageModel = {
  id: string
  name: string
  description?: string
}

export type ImageModelsResult = { ok: true; models: ImageModel[] } | { ok: false; error: string }

export async function fetchImageModels(
  connection: KiloConnectionService,
  dir: string,
  signal?: AbortSignal,
): Promise<ImageModelsResult> {
  const cfg = connection.getServerConfig()
  if (!cfg) return { ok: false, error: "Not connected to the Kilo backend" }

  const auth = Buffer.from(`kilo:${cfg.password}`).toString("base64")
  const url = new URL(PATH, cfg.baseUrl)
  if (dir) url.searchParams.set("directory", dir)

  try {
    const res = await fetch(url, {
      signal,
      headers: { Authorization: `Basic ${auth}` },
    })

    if (!res.ok) {
      return { ok: false, error: `Failed to fetch image models (HTTP ${res.status})` }
    }

    const models = (await res.json()) as ImageModel[]
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) }
  }
}
