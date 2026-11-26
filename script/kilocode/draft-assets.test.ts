import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { check, list } from "./draft-assets"
import * as Artifact from "./sbom/artifact"
import * as Manifest from "./sbom/manifest"

/** A draft holding the CLI evidence set, two VS Code files and one distribution evidence file. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "draft-assets-"))
  const draft = path.join(root, "draft")
  await mkdir(draft)
  const entries: Manifest.Entry[] = []
  for (const artifact of ["kilo-linux-x64.tar.gz", "kilo-darwin-arm64.zip", "kilo-windows-x64.zip"]) {
    await writeFile(path.join(draft, artifact), `bytes of ${artifact}`)
    const sbom = `${artifact}.cdx.json`
    await writeFile(path.join(draft, sbom), `{"subject":"${artifact}"}`)
    entries.push({
      artifact,
      sha256: await Artifact.digest(path.join(draft, artifact)),
      sbom,
      sbomSha256: await Artifact.digest(path.join(draft, sbom)),
    })
  }
  entries.push({ artifact: "kilo-windows-arm64.zip", sha256: "", error: "SBOM generation failed" })
  await writeFile(path.join(draft, "kilo-windows-arm64.zip"), "bytes of kilo-windows-arm64.zip")
  entries[3].sha256 = await Artifact.digest(path.join(draft, "kilo-windows-arm64.zip"))
  const data = { version: "1.2.3", product: "cli", generated: "", expected: entries.length, entries }
  await Manifest.write(path.join(draft, Manifest.name("cli")), data)
  await writeFile(path.join(draft, "kilo-cli-SHA256SUMS"), await Manifest.checksums({ manifest: data, dir: draft }))
  const manifest = await Artifact.digest(path.join(draft, Manifest.name("cli")))

  const vsix = []
  for (const name of ["kilo-vscode-linux-x64.vsix", "vscode-sbom-evidence.json"]) {
    await writeFile(path.join(draft, name), `bytes of ${name}`)
    vsix.push(`${await Artifact.digest(path.join(draft, name))}  ${name}`)
  }
  await writeFile(path.join(draft, "cli-distribution-sbom-evidence.json"), "{}")
  const extra = new Map([
    [
      "cli-distribution-sbom-evidence.json",
      await Artifact.digest(path.join(draft, "cli-distribution-sbom-evidence.json")),
    ],
  ])
  const run = (input: { manifest?: string; vsix?: string; extra?: Map<string, string> } = {}) =>
    check({ draft, manifest, vsix: vsix.join("\n"), extra, ...input })
  return { root, draft, manifest, vsix: vsix.join("\n"), extra, run }
}

test("accepts the draft that holds exactly the expected assets", async () => {
  const f = await fixture()
  try {
    expect(await f.run()).toEqual([])
    expect(await f.run({ vsix: `${f.vsix.replaceAll("\n", "\r\n")}\r\n` })).toEqual([])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("refuses changed, extra and missing assets of every source", async () => {
  const f = await fixture()
  const put = (name: string, text: string) => writeFile(path.join(f.draft, name), text)
  try {
    for (const name of [
      "kilo-windows-x64.zip",
      "kilo-linux-x64.tar.gz.cdx.json",
      "kilo-cli-SHA256SUMS",
      "kilo-vscode-linux-x64.vsix",
      "cli-distribution-sbom-evidence.json",
    ]) {
      const file = path.join(f.draft, name)
      const keep = await Bun.file(file).text()
      await put(name, `${keep}changed`)
      expect(await f.run()).toEqual([expect.stringMatching(new RegExp(`^${name.replaceAll(".", "\\.")}: digest `))])
      await rm(file)
      expect(await f.run()).toEqual([`${name}: missing from the draft`])
      await put(name, keep)
    }

    await put("extra.zip", "extra")
    expect(await f.run()).toEqual(["extra.zip: not expected on the draft"])
    await rm(path.join(f.draft, "extra.zip"))
    await mkdir(path.join(f.draft, "kilo-vscode-linux-x64.vsix.d"))
    expect(await f.run()).toEqual(["kilo-vscode-linux-x64.vsix.d: not expected on the draft"])
    await rm(path.join(f.draft, "kilo-vscode-linux-x64.vsix.d"), { recursive: true })

    // The distribution evidence is expected only once the publish script uploaded it.
    expect(await f.run({ extra: new Map() })).toEqual([
      "cli-distribution-sbom-evidence.json: not expected on the draft",
    ])
    expect(await f.run()).toEqual([])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("trusts the CLI manifest only under the recorded digest", async () => {
  const f = await fixture()
  try {
    const file = path.join(f.draft, Manifest.name("cli"))
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
