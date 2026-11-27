import { expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { check, distribution, list } from "./draft-assets"
import * as Artifact from "./sbom/artifact"
import * as Manifest from "./sbom/manifest"

/** A release holding the CLI evidence set, two VS Code files and the distribution evidence. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "draft-assets-"))
  const entries: Manifest.Entry[] = []
  for (const artifact of ["kilo-linux-x64.tar.gz", "kilo-darwin-arm64.zip", "kilo-windows-x64.zip"]) {
    await writeFile(path.join(root, artifact), `bytes of ${artifact}`)
    const sbom = `${artifact}.cdx.json`
    await writeFile(path.join(root, sbom), `{"subject":"${artifact}"}`)
    entries.push({
      artifact,
      sha256: await Artifact.digest(path.join(root, artifact)),
      sbom,
      sbomSha256: await Artifact.digest(path.join(root, sbom)),
    })
  }
  await writeFile(path.join(root, "kilo-windows-arm64.zip"), "bytes of kilo-windows-arm64.zip")
  entries.push({
    artifact: "kilo-windows-arm64.zip",
    sha256: await Artifact.digest(path.join(root, "kilo-windows-arm64.zip")),
    error: "SBOM generation failed",
  })
  const data = { version: "1.2.3", product: "cli", generated: "", expected: entries.length, entries }
  await Manifest.write(path.join(root, Manifest.name("cli")), data)
  await writeFile(path.join(root, "kilo-cli-SHA256SUMS"), await Manifest.checksums({ manifest: data, dir: root }))
  const manifest = await Artifact.digest(path.join(root, Manifest.name("cli")))

  const vsix = []
  for (const name of ["kilo-vscode-linux-x64.vsix", "vscode-sbom-evidence.json"]) {
    await writeFile(path.join(root, name), `bytes of ${name}`)
    vsix.push(`${await Artifact.digest(path.join(root, name))}  ${name}`)
  }

  // Distribution evidence: an npm tarball (not a release asset) and its sidecar.
  const sidecar = "kilocode-cli-1.2.3.tgz.cdx.json"
  await writeFile(path.join(root, sidecar), "{}")
  const own = {
    version: "1.2.3",
    product: "cli-distribution",
    generated: "",
    expected: 1,
    entries: [
      {
        artifact: "kilocode-cli-1.2.3.tgz",
        sha256: "c".repeat(64),
        sbom: sidecar,
        sbomSha256: await Artifact.digest(path.join(root, sidecar)),
        distribution: "npm",
      },
    ],
  }
  await Manifest.write(path.join(root, "cli-distribution-sbom-evidence.json"), own)
  await writeFile(
    path.join(root, "kilo-cli-distribution-SHA256SUMS"),
    await Manifest.checksums({ manifest: own, dir: root }),
  )
  const uploaded = ["cli-distribution-sbom-evidence.json", "kilo-cli-distribution-SHA256SUMS", sidecar]
  const extra = new Map<string, string>()
  for (const name of uploaded) extra.set(name, await Artifact.digest(path.join(root, name)))

  const assets = async () => {
    const found = new Map<string, string>()
    for (const name of await readdir(root)) found.set(name, await Artifact.digest(path.join(root, name)))
    return found
  }
  const run = async (
    input: { manifest?: string; vsix?: string; extra?: Map<string, string>; published?: boolean } = {},
  ) =>
    check({
      assets: await assets(),
      read: (name) => readFile(path.join(root, name), "utf8"),
      manifest,
      vsix: vsix.join("\n"),
      extra,
      ...input,
    })
  return { root, manifest, vsix: vsix.join("\n"), extra, uploaded, run }
}

test("accepts the release that holds exactly the expected assets", async () => {
  const f = await fixture()
  try {
    expect(await f.run()).toEqual([])
    expect(await f.run({ vsix: `${f.vsix.replaceAll("\n", "\r\n")}\r\n` })).toEqual([])
    // A published release: the distribution evidence must match the manifest it holds.
    expect(await f.run({ extra: undefined, published: true })).toEqual([])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("refuses changed, extra and missing assets of every source", async () => {
  const f = await fixture()
  const put = (name: string, text: string) => writeFile(path.join(f.root, name), text)
  try {
    for (const name of [
      "kilo-windows-x64.zip",
      "kilo-linux-x64.tar.gz.cdx.json",
      "kilo-cli-SHA256SUMS",
      "kilo-vscode-linux-x64.vsix",
      "cli-distribution-sbom-evidence.json",
    ]) {
      const file = path.join(f.root, name)
      const keep = await readFile(file, "utf8")
      await put(name, `${keep}changed`)
      expect(await f.run()).toEqual([expect.stringMatching(new RegExp(`^${name.replaceAll(".", "\\.")}: digest `))])
      await rm(file)
      expect(await f.run()).toEqual([`${name}: missing from the release`])
      await put(name, keep)
    }

    await put("extra.zip", "extra")
    expect(await f.run()).toEqual(["extra.zip: not expected on the release"])
    await rm(path.join(f.root, "extra.zip"))

    // Before the publish script uploaded it, the distribution evidence is not expected.
    expect((await f.run({ extra: new Map() })).sort()).toEqual(
      f.uploaded.map((name) => `${name}: not expected on the release`).sort(),
    )
    expect(await f.run()).toEqual([])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("checks a published release's distribution evidence against its own manifest", async () => {
  const f = await fixture()
  try {
    const sidecar = path.join(f.root, "kilocode-cli-1.2.3.tgz.cdx.json")
    await writeFile(sidecar, '{"changed":true}')
    expect(await f.run({ extra: undefined, published: true })).toEqual([
      expect.stringMatching(/^kilocode-cli-1\.2\.3\.tgz\.cdx\.json: digest /),
    ])
    await writeFile(sidecar, "{}")
    await writeFile(path.join(f.root, "kilo-cli-distribution-SHA256SUMS"), "stale\n")
    expect(await f.run({ extra: undefined, published: true })).toEqual([
      expect.stringMatching(/^kilo-cli-distribution-SHA256SUMS: digest /),
    ])
    await rm(path.join(f.root, "kilo-cli-distribution-SHA256SUMS"))
    await rm(path.join(f.root, "cli-distribution-sbom-evidence.json"))
    expect(await f.run({ extra: undefined, published: true })).toEqual([
      "cli-distribution-sbom-evidence.json: missing from the release",
      "kilocode-cli-1.2.3.tgz.cdx.json: not expected on the release",
    ])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("refuses a sidecar the manifest records without a digest", async () => {
  const f = await fixture()
  try {
    const file = path.join(f.root, "cli-distribution-sbom-evidence.json")
    const own = await Manifest.read(file)
    delete own.entries[0].sbomSha256
    await Manifest.write(file, own)
    await expect(f.run({ extra: undefined, published: true })).rejects.toThrow(
      "kilocode-cli-1.2.3.tgz.cdx.json: the manifest records no digest",
    )
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("trusts the CLI manifest only under the recorded digest", async () => {
  const f = await fixture()
  try {
    const file = path.join(f.root, Manifest.name("cli"))
    const data = await Manifest.read(file)
    data.entries[0].sha256 = "f".repeat(64)
    await Manifest.write(file, data)
    expect(await f.run()).toEqual([expect.stringMatching(/^cli-sbom-evidence\.json: digest [0-9a-f]{64}, expected /)])
    await rm(file)
    expect(await f.run()).toEqual([expect.stringMatching(/^cli-sbom-evidence\.json: digest missing/)])
    await expect(f.run({ manifest: "" })).rejects.toThrow(/no CLI manifest digest/)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("refuses a name expected from two sources and malformed digest lists", async () => {
  const f = await fixture()
  try {
    const twice = new Map([...f.extra, ["kilo-cli-SHA256SUMS", "a".repeat(64)]])
    expect(await f.run({ extra: twice })).toContain("kilo-cli-SHA256SUMS: expected from two sources")
    await expect(f.run({ vsix: "" })).rejects.toThrow(/build-vscode recorded no digests/)
    await expect(f.run({ vsix: `${"a".repeat(64)}  ../x.vsix` })).rejects.toThrow(/Invalid digest line/)
    await expect(f.run({ vsix: `${f.vsix}\n${f.vsix}` })).rejects.toThrow(/listed twice/)
    expect([...list(`${"a".repeat(64)}  a.vsix\r\n`, "test")]).toEqual([["a.vsix", "a".repeat(64)]])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("recognizes only distribution evidence names as leftovers", () => {
  for (const name of [
    "cli-distribution-sbom-evidence.json",
    "kilo-cli-distribution-SHA256SUMS",
    "kilocode-cli-linux-x64-1.2.3.tgz.cdx.json",
    "kilocode-cli-1.2.3-rc.1.tgz.cdx.json",
    "kilo-oci-linux-amd64@aaaaaaaaaaaa.cdx.json",
    "kilo-oci-index@0123456789ab.cdx.json",
  ])
    expect(distribution(name)).toBe(true)
  for (const name of [
    "cli-sbom-evidence.json",
    "kilo-cli-SHA256SUMS",
    "kilo-linux-x64.tar.gz",
    "kilo-linux-x64.tar.gz.cdx.json",
    "kilo-windows-x64.zip.cdx.json",
    "kilo-vscode-linux-x64.vsix",
    "kilo-vscode-linux-x64.vsix.cdx.json",
    "vscode-sbom-evidence.json",
    "kilo-vscode-SHA256SUMS",
  ])
    expect(distribution(name)).toBe(false)
})
