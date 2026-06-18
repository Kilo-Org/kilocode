import zlib from "node:zlib"
import { promisify } from "node:util"

type Callback = (bytes: Uint8Array, cb: (err: Error | null, data: Buffer) => void) => void

const zstd = zlib as typeof zlib & {
  zstdCompress: Callback
  zstdDecompress: Callback
}

const compress = promisify(zstd.zstdCompress)
const decompress = promisify(zstd.zstdDecompress)

export async function compressZstd(bytes: Uint8Array): Promise<Uint8Array> {
  return compress(bytes) as Promise<Uint8Array>
}

export async function decompressZstd(bytes: Uint8Array): Promise<Uint8Array> {
  return decompress(bytes) as Promise<Uint8Array>
}
