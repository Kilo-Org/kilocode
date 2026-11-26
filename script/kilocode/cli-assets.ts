import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import pin from "./bun.json" with { type: "json" }
import { upload } from "./release.ts"
import { digest } from "./sbom/artifact.ts"
import type { Manifest } from "./sbom/manifest.ts"

// The full build ships one archive per pinned runtime. Only trusted basenames
// become filesystem paths or gh arguments, never paths supplied by the build.
const targets = Object.keys(pin.artifacts)
  .map((target) => `kilo-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`)
  .sort((a, b) => a.localeCompare(b))

export async function assets(archives: string, evidence: string, version: string) {
  const manifest = "cli-sbom-evidence.json"
  const sums = "kilo-cli-SHA256SUMS"
  async function names(dir: string) {
    return (await readdir(dir, { withFileTypes: true })).map((file) => {
      assert(file.isFile(), "Expected only regular files")
      return file.name
    })
  }
  assert.deepEqual((await names(archives)).sort(), [...targets].sort(), "Unexpected CLI archive set")
  const sidecars = await names(evidence)
  const data: Manifest = JSON.parse(await readFile(path.join(evidence, manifest), "utf8"))
  assert.equal(data.product, "cli")
  assert.equal(data.version, version)
  assert.equal(data.expected, targets.length)
  assert.equal(data.entries.length, targets.length)

  const files = [path.join(evidence, manifest), path.join(evidence, sums)]
  const expected = [manifest, sums]
  const lines = []
  for (const name of targets) {
    const entry = data.entries.find((item) => item.artifact === name)
    assert(entry, `Missing manifest entry: ${name}`)
    const file = path.join(archives, name)
    assert.equal(await digest(file), entry.sha256, `${name}: digest mismatch`)
    lines.push(`${entry.sha256}  ${name}`)
    files.push(file)
    // In advisory mode SBOM generation can record a failure instead of a sidecar.
    if (entry.error && entry.sbom === undefined) continue
    const sidecar = `${name}.cdx.json`
    assert.equal(entry.sbom, sidecar)
    const bom = path.join(evidence, sidecar)
    assert.equal(await digest(bom), entry.sbomSha256, `${sidecar}: digest mismatch`)
    lines.push(`${entry.sbomSha256}  ${sidecar}`)
    expected.push(sidecar)
    files.push(bom)
  }
  assert.deepEqual(sidecars.sort(), expected.sort(), "Unexpected CLI evidence set")
  assert.equal(await readFile(path.join(evidence, sums), "utf8"), `${lines.join("\n")}\n`, "Invalid CLI checksums")
  return files
}

if (import.meta.main) {
  const [archives, evidence, version] = process.argv.slice(2)
  await upload({ tag: `v${version}`, files: await assets(archives, evidence, version) })
}
