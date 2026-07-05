import { MemoryMarkerMeta } from "@kilocode/kilo-memory/marker-meta"

export namespace MemoryTuiMeta {
  export function fromParts(parts: readonly MemoryMarkerMeta.Part[]) {
    return MemoryMarkerMeta.fromParts(parts)
  }
}
