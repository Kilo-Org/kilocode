import { createHash } from "node:crypto"
import { rename, rm } from "node:fs/promises"
import path from "node:path"

const manifest = await Bun.file(new URL("../backend/src/main/resources/kilo-v2-cli.properties", import.meta.url)).text()
const version = manifest.match(/^cli\.version=(0\.0\.0-v2-\d+)$/m)?.[1]
if (!version || !process.argv[2]) throw new Error("Missing v2 release pin or output directory")
const assets = [...manifest.matchAll(/^cli\.integrity\.([\w-]+)=(sha512-[A-Za-z\d+/]+==)$/gm)]
if (assets.length !== 6) throw new Error("Expected all six platform integrity pins")

for (const [, target, integrity] of assets) {
  const output = path.join(process.argv[2], "kilo-v2-cli", `${target}.tgz`)
  if ((await Bun.file(output).exists()) && (await checksum(output)) === integrity) continue
  const url = `https://registry.npmjs.org/@kilocode/cli-${target}/-/cli-${target}-${version}.tgz`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const tmp = `${output}.part`
  try {
    await Bun.write(tmp, response)
    if ((await checksum(tmp)) !== integrity) throw new Error(`Integrity mismatch: ${target}`)
    await rename(tmp, output)
    console.log(`Staged ${target}@${version}`)
  } finally {
    await rm(tmp, { force: true })
  }
}

async function checksum(file: string) {
  const hash = createHash("sha512")
  for await (const bytes of Bun.file(file).stream()) hash.update(bytes)
  return `sha512-${hash.digest("base64")}`
}
