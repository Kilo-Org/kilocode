import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cp, mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assets, signed } from "./cli-assets"
import pin from "./bun.json"
import * as Artifact from "./sbom/artifact"
import * as Manifest from "./sbom/manifest"

const version = "1.2.3"

/** The build evidence, the signed Windows zips and the evidence sbom-cli-windows wrote for them. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-assets-"))
  const archives = path.join(root, "archives")
  const build = path.join(root, "build")
  const evidence = path.join(root, "evidence")
  await Promise.all([mkdir(archives), mkdir(build), mkdir(evidence)])
  const built: Manifest.Entry[] = []
  const final: Manifest.Entry[] = []
  const zips: string[] = []
  for (const target of Object.keys(pin.artifacts)) {
    const artifact = `kilo-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`
    const file = path.join(archives, artifact)
    await Bun.write(file, `unsigned ${target}`)
    const sha256 = await Artifact.digest(file)
    if (target === "darwin-arm64") {
      const entry = { artifact, sha256, error: "no sidecar generated" }
      built.push(entry)
      final.push({ ...entry })
      continue
    }
    const sbom = `${artifact}.cdx.json`
    await Bun.write(path.join(build, sbom), JSON.stringify({ artifact, sha256 }))
    const entry = { artifact, sha256, sbom, sbomSha256: await Artifact.digest(path.join(build, sbom)) }
    built.push(entry)
    if (!target.startsWith("windows-")) {
      await cp(path.join(build, sbom), path.join(evidence, sbom))
      final.push({ ...entry })
      continue
    }
    await Bun.write(file, `signed ${target}`)
    const signed = await Artifact.digest(file)
    zips.push(`${signed}  ${artifact}`)
    await Bun.write(path.join(evidence, sbom), JSON.stringify({ artifact, sha256: signed }))
    final.push({ artifact, sha256: signed, sbom, sbomSha256: await Artifact.digest(path.join(evidence, sbom)) })
  }
  const write = async (dir: string, entries: Manifest.Entry[]) => {
    const manifest = { version, product: "cli", generated: "", expected: entries.length, entries }
    await Manifest.write(path.join(dir, Manifest.name("cli")), manifest)
    await Bun.write(path.join(dir, "kilo-cli-SHA256SUMS"), await Manifest.checksums({ manifest, dir }))
  }
  await write(build, built)
  await write(evidence, final)
  const text = zips.join("\n")
  const verify = () => assets({ archives, build, evidence, version, zips: signed(text) })
  return { root, archives, build, evidence, built, final, text, write, verify }
}

test("hands the signed zips, the build archives and their evidence to the uploader", async () => {
  const f = await fixture()
  try {
    const result = await f.verify()
    expect(result.files.length).toBe(25) // 12 archives, 11 sidecars, manifest and checksums
    // Every archive with a sidecar is attested; the Windows zips under the digests sign-cli-windows recorded.
    expect(result.subjects.include.length).toBe(11)
    const zips = signed(f.text)
    for (const [name, sha] of zips) {
      expect(result.subjects.include).toContainEqual(
        expect.objectContaining({ artifact: name, digest: `sha256:${sha}` }),
      )
    }
    const linux = result.subjects.include.find((item) => item.artifact === "kilo-linux-x64.tar.gz")
    expect(linux?.digest).toBe(`sha256:${f.final.find((item) => item.artifact === "kilo-linux-x64.tar.gz")!.sha256}`)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("refuses unsigned zips, changed build entries and a damaged set", async () => {
  const f = await fixture()
  try {
    const zip = path.join(f.archives, "kilo-windows-x64.zip")
    await Bun.write(zip, "unsigned windows-x64")
    await assert.rejects(f.verify, /kilo-windows-x64\.zip: digest mismatch/)
    await Bun.write(zip, "signed windows-x64")

    // Evidence that names another digest for a Windows zip than sign-cli-windows recorded.
    await assert.rejects(
      () =>
        assets({
          archives: f.archives,
          build: f.build,
          evidence: f.evidence,
          version,
          zips: signed(f.text.replace(/^[0-9a-f]{64}(?=  kilo-windows-x64\.zip)/m, "e".repeat(64))),
        }),
      /not the digest sign-cli-windows recorded/,
    )
    await assert.rejects(
      () =>
        assets({
          archives: f.archives,
          build: f.build,
          evidence: f.evidence,
          version,
          zips: signed(f.text.split("\n")[0]),
        }),
      /Unexpected signed Windows zip set/,
    )

    // Evidence that changes a build entry.
    const linux = f.final.find((item) => item.artifact === "kilo-linux-x64.tar.gz")!
    const original = linux.sha256
    linux.sha256 = "f".repeat(64)
    await f.write(f.evidence, f.final)
    await assert.rejects(f.verify, /evidence entry differs from the build manifest/)
    linux.sha256 = original
    await f.write(f.evidence, f.final)

    const sums = path.join(f.evidence, "kilo-cli-SHA256SUMS")
    const checksums = await Bun.file(sums).text()
    await Bun.write(sums, `${checksums}invalid\n`)
    await assert.rejects(f.verify, /Invalid CLI checksums/)
    await Bun.write(sums, checksums)

    const stale = path.join(f.evidence, "kilo-windows-x64.zip.cdx.json")
    const bom = await Bun.file(stale).text()
    await Bun.write(stale, "{}")
    await assert.rejects(f.verify, /kilo-windows-x64\.zip\.cdx\.json: digest mismatch/)
    await Bun.write(stale, bom)

    const extra = path.join(f.archives, "unexpected.zip")
    await Bun.write(extra, "extra")
    await assert.rejects(f.verify, /Unexpected CLI archive set/)
    await rm(extra)
    const file = path.join(f.archives, "kilo-linux-x64.tar.gz")
    await rm(file)
    await assert.rejects(f.verify, /Unexpected CLI archive set/)
    await symlink(sums, file)
    await assert.rejects(f.verify, /Expected only regular files/)
    await rm(file)
    await Bun.write(file, "unsigned linux-x64")
    expect((await f.verify()).files.length).toBe(25)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("with SBOM_ENFORCE every archive needs a sidecar and an attestation subject", async () => {
  const f = await fixture()
  const run = (env: Record<string, string>) =>
    assets({ archives: f.archives, build: f.build, evidence: f.evidence, version, zips: signed(f.text), env })
  try {
    // The fixture records darwin-arm64 with a failure instead of a sidecar.
    expect((await run({})).files.length).toBe(25)
    await assert.rejects(() => run({ SBOM_ENFORCE: "true" }), /kilo-darwin-arm64\.zip: no SBOM evidence/)

    // Give darwin-arm64 a sidecar, so that only the Windows entry below can fail.
    const darwin = "kilo-darwin-arm64.zip"
    for (const dir of [f.build, f.evidence]) await Bun.write(path.join(dir, `${darwin}.cdx.json`), "{}")
    for (const entries of [f.built, f.final]) {
      const entry = entries.find((item) => item.artifact === darwin)!
      delete entry.error
      Object.assign(entry, {
        sbom: `${darwin}.cdx.json`,
        sbomSha256: await Artifact.digest(path.join(f.build, `${darwin}.cdx.json`)),
      })
    }
    await f.write(f.build, f.built)
    await f.write(f.evidence, f.final)
    expect((await run({ SBOM_ENFORCE: "true" })).subjects.include.length).toBe(12)

    // A Windows entry whose description failed after signing.
    const windows = f.final.find((item) => item.artifact === "kilo-windows-x64.zip")!
    delete windows.sbom
    delete windows.sbomSha256
    windows.error = "SBOM generation failed"
    await rm(path.join(f.evidence, "kilo-windows-x64.zip.cdx.json"))
    await f.write(f.evidence, f.final)
    expect((await run({})).subjects.include.map((item) => item.artifact)).not.toContain("kilo-windows-x64.zip")
    await assert.rejects(() => run({ SBOM_ENFORCE: "1" }), /kilo-windows-x64\.zip: no SBOM evidence/)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("parses the signed zip digests with any line end", () => {
  const two = `${"a".repeat(64)}  kilo-windows-arm64.zip\r\n${"b".repeat(64)}  kilo-windows-x64.zip\r\n`
  expect([...signed(two)]).toEqual([
    ["kilo-windows-arm64.zip", "a".repeat(64)],
    ["kilo-windows-x64.zip", "b".repeat(64)],
  ])
  expect([...signed(`${"a".repeat(64)}  kilo-windows-x64.zip\r`)]).toEqual([["kilo-windows-x64.zip", "a".repeat(64)]])
  expect(() => signed("")).toThrow(/no signed zip digests/)
  expect(() => signed(`${"a".repeat(64)}  kilo-windows-x64.zip\n${"a".repeat(64)}  kilo-windows-x64.zip`)).toThrow(
    /listed twice/,
  )
  expect(() => signed(`${"A".repeat(64)}  kilo-windows-x64.zip`)).toThrow(/Invalid/)
  expect(() => signed(`${"a".repeat(64)}  kilo-linux-x64.tar.gz`)).toThrow(/Invalid/)
})
