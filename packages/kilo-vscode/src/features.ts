import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import type { KiloClient } from "@kilocode/sdk/v2"

type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

export type Features = {
  indexing: boolean
  sandboxControls: boolean
  backgroundSubagents: boolean
}

export function configFeatures(config?: ConfigLike | null, backgroundSubagents = false): Features {
  return {
    indexing: hasIndexingPlugin(config?.plugin ?? []),
    sandboxControls: process.platform !== "win32",
    backgroundSubagents,
  }
}

export async function serverFeatures(client: Pick<KiloClient, "experimental">, dir: string) {
  if (!client.experimental?.capabilities?.get) return false
  try {
    const { data } = await client.experimental.capabilities.get({ directory: dir }, { throwOnError: true })
    return data?.backgroundSubagents === true
  } catch (error) {
    console.warn("[Kilo New] Failed to fetch server capabilities:", error)
    return false
  }
}
