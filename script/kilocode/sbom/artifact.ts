import { createHash } from "node:crypto"
import fs from "node:fs"

/** Streaming SHA-256 so multi-hundred-MB release archives are not buffered. */
export async function digest(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

export async function subject(file: string, name?: string) {
  const stat = await fs.promises.stat(file)
  return { name: name ?? file.split(/[\\/]/).at(-1)!, sha256: await digest(file), size: stat.size }
}

/** Sidecar path convention: the artifact filename plus `.cdx.json`. */
export function sidecar(file: string) {
  return `${file}.cdx.json`
}
