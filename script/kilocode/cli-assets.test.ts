import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assets } from "./cli-assets"
import pin from "./bun.json"
import * as Artifact from "./sbom/artifact"
import * as Manifest from "./sbom/manifest"

test("only hands verified same-build archives and evidence to the uploader", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-assets-"))
  const archives = path.join(root, "archives")
  const evidence = path.join(root, "evidence")
  try {
    await Promise.all([mkdir(archives), mkdir(evidence)])
    const entries: Manifest.Entry[] = []
    for (const target of Object.keys(pin.artifacts)) {
      const artifact = `kilo-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`
      const file = path.join(archives, artifact)
      await Bun.write(file, target)
      const sha256 = await Artifact.digest(file)
      if (target === "darwin-arm64") {
        entries.push({ artifact, sha256, error: "no sidecar generated" })
        continue
      }
      const sbom = `${artifact}.cdx.json`
      const bom = path.join(evidence, sbom)
      await Bun.write(bom, JSON.stringify({ artifact, sha256 }))
      entries.push({ artifact, sha256, sbom, sbomSha256: await Artifact.digest(bom) })
    }
    const version = "1.2.3"
    const manifest = { version, product: "cli", generated: "", expected: entries.length, entries }
    const write = () => Manifest.write(path.join(evidence, Manifest.name("cli")), manifest)
    await write()
    const sums = path.join(evidence, "kilo-cli-SHA256SUMS")
    const checksums = await Manifest.checksums({ manifest, dir: evidence })
    await Bun.write(sums, checksums)
    const verify = () => assets(archives, evidence, version)
    expect((await verify()).length).toBe(25) // 12 archives, 11 sidecars, manifest and checksums

    await Bun.write(sums, `${checksums}invalid\n`)
    await assert.rejects(verify, /Invalid CLI checksums/)
    await Bun.write(sums, checksums)
    const entry = entries.find((item) => item.sbom)!
    const sidecar = entry.sbom!
    entry.sbom = "../other"
    await write()
    await assert.rejects(verify, assert.AssertionError)
    entry.sbom = sidecar
    await write()
    const extra = path.join(archives, "unexpected.zip")
    await Bun.write(extra, "extra")
    await assert.rejects(verify, /Unexpected CLI archive set/)
    await rm(extra)
    const file = path.join(archives, entry.artifact)
    await Bun.write(file, "changed bytes")
    await assert.rejects(verify, /digest mismatch/)
    await rm(file)
    await assert.rejects(verify, /Unexpected CLI archive set/)
    await symlink(sums, file)
    await assert.rejects(verify, /Expected only regular files/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
