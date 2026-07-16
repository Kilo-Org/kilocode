import { MemoryMarkerMeta } from "@kilocode/kilo-memory/marker-meta"

export namespace MemoryTuiMeta {
  export function fromParts(parts: readonly MemoryMarkerMeta.Part[]) {
    return MemoryMarkerMeta.fromParts(parts)
  }

  export function snippets(input: MemoryMarkerMeta.Decoded | undefined, verbose: boolean) {
    return MemoryMarkerMeta.snippets(input, verbose)
  }
}
