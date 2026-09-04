import * as fs from "fs/promises"

const SAMPLE_BYTES = 8_192

function binary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false

  let controls = 0
  for (const byte of bytes) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) controls++
  }
  return controls / bytes.length > 0.3
}

export async function binaryFile(file: string): Promise<boolean> {
  return (await probe(file)) ?? false
}

export async function probe(file: string): Promise<boolean | undefined> {
  const stat = await fs.lstat(file).catch(() => undefined)
  if (!stat) return undefined
  if (!stat.isFile()) return false

  const handle = await fs.open(file, "r").catch(() => undefined)
  if (!handle) return undefined
  const sample = Buffer.alloc(SAMPLE_BYTES)
  const read = await handle
    .read(sample, 0, sample.length, 0)
    .catch(() => undefined)
    .finally(() => handle.close())
  if (!read) return undefined
  return binary(sample.subarray(0, read.bytesRead))
}
