import { MemoryMarkerMeta } from "@kilocode/kilo-memory/marker-meta"

export namespace MemoryTuiMeta {
  export function fromParts(parts: readonly MemoryMarkerMeta.Part[]) {
    return MemoryMarkerMeta.fromParts(parts)
  }

  export function items(input: unknown) {
    const value = input as { items?: unknown } | undefined
    if (!Array.isArray(value?.items)) return []
    return value.items.filter((item): item is string => typeof item === "string")
  }
}
