import { createHash } from "crypto"

export namespace MemorySlug {
  export const max = {
    key: 80,
    label: 96,
    record: 120,
    parts: 5,
    hash: 10,
  }

  export function safe(input: string, opts: { max: number; fallback: string; lower?: boolean }) {
    const text = opts.lower ? input.toLowerCase() : input
    const value = text
      .normalize("NFKC")
      .replaceAll(/[^\p{L}\p{N}_.-]+/gu, "_")
      .replaceAll(/^_+|_+$/g, "")
      .slice(0, opts.max)
    return value || opts.fallback
  }

  export function hash(input: string, prefix: string) {
    return `${prefix}_${createHash("sha1").update(input).digest("hex").slice(0, max.hash)}`
  }
}
