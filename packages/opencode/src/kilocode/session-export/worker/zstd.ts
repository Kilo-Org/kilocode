import { zstdCompress, zstdDecompress } from "node:zlib"
import { promisify } from "node:util"

const compress = promisify(zstdCompress)
const decompress = promisify(zstdDecompress)

export async function compressZstd(bytes: Uint8Array): Promise<Uint8Array> {
  return compress(bytes) as Promise<Uint8Array>
}

export async function decompressZstd(bytes: Uint8Array): Promise<Uint8Array> {
  return decompress(bytes) as Promise<Uint8Array>
}
