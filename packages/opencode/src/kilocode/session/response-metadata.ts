import type { ProviderMetadata } from "@opencode-ai/llm"
import { isRecord } from "@/util/record"

export namespace KiloResponseMetadata {
  export function write(metadata: ProviderMetadata | undefined, headers: Record<string, string> | undefined) {
    const id = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "x-vercel-id")?.[1]
    if (!id) return metadata
    const kilo = isRecord(metadata?.kilo) ? metadata.kilo : {}
    return { ...metadata, kilo: { ...kilo, vercelID: id } }
  }

  export function read(metadata: ProviderMetadata | undefined) {
    const kilo = metadata?.kilo
    if (!isRecord(kilo)) return
    return typeof kilo.vercelID === "string" ? kilo.vercelID : undefined
  }
}
