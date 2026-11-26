import assert from "node:assert/strict"
import { appendFile, readdir, readFile } from "node:fs/promises"
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
const windows = targets.filter((name) => name.startsWith("kilo-windows-"))

const MANIFEST = "cli-sbom-evidence.json"
const SUMS = "kilo-cli-SHA256SUMS"

/** Parses the `<sha256>  <zip>` lines sign-cli-windows records for the zips it signed (LF or CRLF). */
export function signed(text: string) {
  const zips = new Map<string, string>()
  for (const line of text.split(/\r\n|\n|\r/).filter((item) => item.trim() !== "")) {
    const match = /^([0-9a-f]{64}) {2}(kilo-windows-[a-z0-9-]+\.zip)$/.exec(line)
    if (!match) throw new Error(`Invalid signed zip digest line: ${JSON.stringify(line)}`)
    if (zips.has(match[2])) throw new Error(`${match[2]} is listed twice in the signed zip digests`)
    zips.set(match[2], match[1])
  }
  if (zips.size === 0) throw new Error("sign-cli-windows recorded no signed zip digests")
  return zips
}

async function names(dir: string) {
  return (await readdir(dir, { withFileTypes: true })).map((file) => {
    assert(file.isFile(), "Expected only regular files")
    return file.name
  })
}

async function manifest(dir: string, version: string) {
  const data: Manifest = JSON.parse(await readFile(path.join(dir, MANIFEST), "utf8"))
  assert.equal(data.product, "cli")
  assert.equal(data.version, version)
  assert.equal(data.expected, targets.length)
  assert.equal(data.entries.length, targets.length)
  return data
}

/**
 * Checks the CLI release set before upload-cli transfers it. Each digest is tied to the job
 * that produced the bytes, through a digest only that job sets:
 * - build-cli: every archive except the Windows zips, and the build evidence in `build`
 * - sign-cli-windows: the signed Windows zips (`zips`)
 * - sbom-cli-windows: the evidence in `evidence`, which describes the signed zips and repeats
 *   every other build entry unchanged
 *
 * Returns the files to upload and the attestation subjects (each published archive that has a
 * sidecar, with the sidecar digest attest-cli checks).
 */
export async function assets(input: {
  archives: string
  build: string
  evidence: string
  version: string
  zips: Map<string, string>
}) {
  assert.deepEqual((await names(input.archives)).sort(), [...targets].sort(), "Unexpected CLI archive set")
  assert.deepEqual([...input.zips.keys()].sort(), [...windows].sort(), "Unexpected signed Windows zip set")
  const build = await manifest(input.build, input.version)
  const data = await manifest(input.evidence, input.version)

  const files = [path.join(input.evidence, MANIFEST), path.join(input.evidence, SUMS)]
  const expected = [MANIFEST, SUMS]
  const lines = []
  const include = []
  for (const name of targets) {
    const entry = data.entries.find((item) => item.artifact === name)
    assert(entry, `Missing manifest entry: ${name}`)
    const zip = input.zips.get(name)
    if (zip) assert.equal(entry.sha256, zip, `${name}: not the digest sign-cli-windows recorded`)
    else {
      const recorded = build.entries.find((item) => item.artifact === name)
      assert.deepEqual(entry, recorded, `${name}: evidence entry differs from the build manifest`)
    }
    const file = path.join(input.archives, name)
    assert.equal(await digest(file), entry.sha256, `${name}: digest mismatch`)
    lines.push(`${entry.sha256}  ${name}`)
    files.push(file)
    // In advisory mode SBOM generation can record a failure instead of a sidecar.
    if (entry.error && entry.sbom === undefined) continue
    const sidecar = `${name}.cdx.json`
    assert.equal(entry.sbom, sidecar)
    const bom = path.join(input.evidence, sidecar)
    assert.equal(await digest(bom), entry.sbomSha256, `${sidecar}: digest mismatch`)
    lines.push(`${entry.sbomSha256}  ${sidecar}`)
    expected.push(sidecar)
    files.push(bom)
    // The subject digest of a Windows zip is the one sign-cli-windows recorded (equal to the entry, checked above).
    if (!entry.error) {
      include.push({
        artifact: name,
        digest: `sha256:${zip ?? entry.sha256}`,
        sbom: sidecar,
        sbomSha256: entry.sbomSha256,
      })
    }
  }
  assert.deepEqual((await names(input.evidence)).sort(), expected.sort(), "Unexpected CLI evidence set")
  assert.equal(
    await readFile(path.join(input.evidence, SUMS), "utf8"),
    `${lines.join("\n")}\n`,
    "Invalid CLI checksums",
  )
  return { files, subjects: { include } }
}

if (import.meta.main) {
  const [archives, build, evidence, version] = process.argv.slice(2)
  const checked = await assets({ archives, build, evidence, version, zips: signed(process.env.SIGNED_ZIPS ?? "") })
  await upload({ tag: `v${version}`, files: checked.files })
  // Appended, never rewritten: the runner owns this file.
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `subjects=${JSON.stringify(checked.subjects)}\n`)
}
