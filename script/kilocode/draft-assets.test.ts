import { expect, test } from "bun:test"
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { check, signed, sums } from "./draft-assets"
import * as Artifact from "./sbom/artifact"
import * as Manifest from "./sbom/manifest"

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "draft-assets-"))
  const dist = path.join(root, "dist")
  const draft = path.join(root, "draft")
  await Promise.all([mkdir(dist), mkdir(draft)])
  const entries: Manifest.Entry[] = []
  for (const artifact of ["kilo-linux-x64.tar.gz", "kilo-darwin-arm64.zip", "kilo-windows-x64.zip"]) {
    await writeFile(path.join(draft, artifact), `unsigned ${artifact}`)
    const sbom = `${artifact}.cdx.json`
    await writeFile(path.join(draft, sbom), `{"subject":"${artifact}"}`)
    entries.push({
      artifact,
      sha256: await Artifact.digest(path.join(draft, artifact)),
      sbom,
      sbomSha256: await Artifact.digest(path.join(draft, sbom)),
    })
  }
  const manifest = { version: "1.2.3", product: "cli", generated: "", expected: entries.length, entries }
  await Manifest.write(path.join(dist, Manifest.name("cli")), manifest)
  const original = await Manifest.checksums({ manifest, dir: draft })
  await writeFile(path.join(dist, "kilo-cli-SHA256SUMS"), original)
  await cp(path.join(dist, Manifest.name("cli")), path.join(draft, Manifest.name("cli")))

  await writeFile(path.join(draft, "kilo-windows-x64.zip"), "signed kilo-windows-x64.zip")
  const zips = `${await Artifact.digest(path.join(draft, "kilo-windows-x64.zip"))}  kilo-windows-x64.zip`
  await writeFile(path.join(draft, "kilo-cli-SHA256SUMS"), sums(original, signed(zips)))
  return { root, dist, draft, zips, original }
}

test("accepts the draft that holds exactly the checked assets", async () => {
  const f = await fixture()
  try {
    expect(await check({ draft: f.draft, dist: f.dist, signed: f.zips })).toEqual([])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("accepts the signed digest list with CRLF line ends", async () => {
  const f = await fixture()
  try {
    expect(await check({ draft: f.draft, dist: f.dist, signed: `${f.zips}\r\n` })).toEqual([])
    expect(await check({ draft: f.draft, dist: f.dist, signed: `${f.zips}\r` })).toEqual([])
    const two = `${"a".repeat(64)}  kilo-windows-arm64.zip\r\n${"b".repeat(64)}  kilo-windows-x64.zip\r\n`
    expect([...signed(two)]).toEqual([
      ["kilo-windows-arm64.zip", "a".repeat(64)],
      ["kilo-windows-x64.zip", "b".repeat(64)],
    ])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("refuses replaced, extra, missing, unsigned and stale assets", async () => {
  const f = await fixture()
  const run = () => check({ draft: f.draft, dist: f.dist, signed: f.zips })
  try {
    await writeFile(path.join(f.draft, "kilo-linux-x64.tar.gz"), "replaced")
    expect(await run()).toEqual([expect.stringMatching(/^kilo-linux-x64\.tar\.gz: digest /)])
    await writeFile(path.join(f.draft, "kilo-linux-x64.tar.gz"), "unsigned kilo-linux-x64.tar.gz")

    await writeFile(path.join(f.draft, "kilo-linux-x64.tar.gz.cdx.json"), "{}")
    expect(await run()).toEqual([expect.stringMatching(/^kilo-linux-x64\.tar\.gz\.cdx\.json: digest /)])
    await writeFile(path.join(f.draft, "kilo-linux-x64.tar.gz.cdx.json"), '{"subject":"kilo-linux-x64.tar.gz"}')

    await writeFile(path.join(f.draft, "extra.zip"), "extra")
    expect(await run()).toEqual(["extra.zip: not expected on the draft"])
    await rm(path.join(f.draft, "extra.zip"))

    await rm(path.join(f.draft, "kilo-darwin-arm64.zip"))
    expect(await run()).toEqual(["kilo-darwin-arm64.zip: missing from the draft"])
    await writeFile(path.join(f.draft, "kilo-darwin-arm64.zip"), "unsigned kilo-darwin-arm64.zip")

    await writeFile(path.join(f.draft, "kilo-windows-x64.zip"), "unsigned kilo-windows-x64.zip")
    expect(await run()).toEqual([expect.stringMatching(/^kilo-windows-x64\.zip: digest /)])
    await writeFile(path.join(f.draft, "kilo-windows-x64.zip"), "signed kilo-windows-x64.zip")

    await writeFile(path.join(f.draft, "kilo-cli-SHA256SUMS"), f.original)
    expect(await run()).toEqual([expect.stringMatching(/^kilo-cli-SHA256SUMS: digest /)])
    await writeFile(path.join(f.draft, "kilo-cli-SHA256SUMS"), sums(f.original, signed(f.zips)))

    expect(await run()).toEqual([])
    await expect(check({ draft: f.draft, dist: f.dist, signed: "" })).rejects.toThrow(/no signed zip digests/)
    await expect(check({ draft: f.draft, dist: f.dist, signed: `${f.zips}\n${f.zips}` })).rejects.toThrow(
      /listed twice/,
    )
    await expect(check({ draft: f.draft, dist: f.dist, signed: f.zips.toUpperCase() })).rejects.toThrow(/Invalid/)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("requires a signed digest for every Windows zip in the manifest", async () => {
  const f = await fixture()
  try {
    const other = `${"b".repeat(64)}  kilo-windows-arm64.zip`
    expect(await check({ draft: f.draft, dist: f.dist, signed: other })).toEqual([
      "kilo-windows-arm64.zip: not in the build manifest",
      "kilo-windows-x64.zip: sign-cli-windows recorded no signed digest",
    ])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("rewrites only the signed zip lines of the checksum file", () => {
  const original = `${"a".repeat(64)}  kilo-linux-x64.tar.gz\n${"c".repeat(64)}  kilo-windows-x64.zip\n`
  const zips = signed(`${"d".repeat(64)}  kilo-windows-x64.zip`)
  expect(sums(original, zips)).toBe(
    `${"a".repeat(64)}  kilo-linux-x64.tar.gz\n${"d".repeat(64)}  kilo-windows-x64.zip\n`,
  )
  expect(() => sums(`${"a".repeat(64)}  kilo-linux-x64.tar.gz\n`, zips)).toThrow(/listed 0 times/)
})
