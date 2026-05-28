import { createHash } from "node:crypto"
import { Storage } from "./storage"
import { compressZstd, decompressZstd } from "./zstd"

export type ChunkerConfig = { chunkBytes: number }

export class Chunker {
  constructor(
    private readonly storage: Storage,
    private readonly cfg: ChunkerConfig,
  ) {}

  async write(bytes: Uint8Array): Promise<string[]> {
    const ids: string[] = []
    for (let offset = 0; offset < bytes.byteLength; offset += this.cfg.chunkBytes) {
      const slice = bytes.subarray(offset, Math.min(offset + this.cfg.chunkBytes, bytes.byteLength))
      const id = sha256Hex(slice)
      ids.push(id)

      const row = this.storage.getChunk(id)
      if (row) {
        this.storage.incrementRefCount(id)
        continue
      }
      const zipped = await compressZstd(slice)
      this.storage.upsertChunk({ id, bytes: zipped, size: slice.byteLength, encoding: "zstd" })
    }
    return ids
  }

  async read(ids: string[]): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    let total = 0
    for (const id of ids) {
      const row = this.storage.getChunk(id)
      if (!row) throw new Error(`missing chunk ${id}`)
      const part = await decompressZstd(row.bytes)
      if (sha256Hex(part) !== id) throw new Error(`chunk hash mismatch for ${id}`)
      parts.push(part)
      total += part.byteLength
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      out.set(part, offset)
      offset += part.byteLength
    }
    return out
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
