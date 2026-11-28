import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DISTRIBUTION, DISTRIBUTION_SUMS } from "./draft-assets"
import { evidence } from "./release-undraft"
import type { Entry } from "./sbom/manifest"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const npm = "kilocode-cli-1.2.3.tgz.cdx.json"
const oci = "kilo-oci-linux-amd64@0123456789ab.cdx.json"
/** The bytes of each sidecar: a different text per name. */
const sidecar = (name: string) => `${JSON.stringify({ name })}\n`
const entries: Entry[] = [
  {
    artifact: "kilocode-cli-1.2.3.tgz",
    sha256: "a".repeat(64),
    sbom: npm,
    sbomSha256: hash(sidecar(npm)),
    distribution: "npm",
  },
  {
    artifact: "ghcr.io/kilo-org/kilocode@sha256:0123456789ab",
    sha256: "b".repeat(64),
    sbom: oci,
    sbomSha256: hash(sidecar(oci)),
    distribution: "oci",
  },
  {
    artifact: "kilocode-cli-linux-x64-1.2.3.tgz",
    sha256: "c".repeat(64),
    error: "no sidecar generated",
    distribution: "npm",
  },
]
/** The checksum file Manifest.checksums writes for `list`: artifacts by name, each followed by its sidecar. */
const sums = (list: Entry[]) =>
  `${[...list]
    .sort((a, b) => a.artifact.localeCompare(b.artifact))
    .flatMap((entry) => [
      `${entry.sha256}  ${entry.artifact}`,
      ...(entry.sbom ? [`${entry.sbomSha256}  ${entry.sbom}`] : []),
    ])
    .join("\n")}\n`

/** Writes the evidence files into a temporary directory and returns their paths. */
async function files(names: string[], manifest: Entry[] = entries, texts: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "release-undraft-"))
  roots.push(root)
  return Promise.all(
    names.map(async (name) => {
      const file = path.join(root, name)
      const text =
        texts[name] ??
        (name === DISTRIBUTION
          ? JSON.stringify({ version: "1.2.3", entries: manifest })
          : name === DISTRIBUTION_SUMS
            ? sums(manifest)
            : sidecar(name))
      await writeFile(file, text)
      return file
    }),
  )
}

const complete = [DISTRIBUTION, DISTRIBUTION_SUMS, npm, oci]

test("the distribution evidence of the stage's entries passes, in any order", async () => {
  expect(await evidence(await files(complete), entries)).toEqual([])
  expect(await evidence(await files([...complete].reverse(), [...entries].reverse()), entries)).toEqual([])
})

test("a file that is not distribution evidence is refused before any upload", async () => {
  const problems = await evidence(await files([...complete, "kilo-linux-x64.tar.gz"]), entries)
  expect(problems.join("\n")).toContain("kilo-linux-x64.tar.gz is not distribution evidence")
  expect((await evidence(await files([...complete, "cli-sbom-evidence.json"]), entries)).join("\n")).toContain(
    "cli-sbom-evidence.json is not distribution evidence",
  )
})

test("the manifest and its checksum file are both required", async () => {
  expect(await evidence(await files([DISTRIBUTION, npm, oci]), entries)).toEqual([
    `${DISTRIBUTION_SUMS} is missing from the stage`,
  ])
  expect(await evidence(await files([DISTRIBUTION_SUMS, npm, oci]), entries)).toEqual([
    `${DISTRIBUTION} is missing from the stage`,
  ])
})

test("the sidecars must be exactly the ones the entries name", async () => {
  expect((await evidence(await files([DISTRIBUTION, DISTRIBUTION_SUMS, npm]), entries)).join("\n")).toContain(
    "are not the ones the entries name",
  )
  const extra = "kilocode-sdk-1.2.3.tgz.cdx.json"
  expect((await evidence(await files([...complete, extra]), entries)).join("\n")).toContain(
    "are not the ones the entries name",
  )
})

test("the manifest's entries must be the stage's entries", async () => {
  // The checksum file stays the one of the stage's entries, so only the manifest differs.
  const texts = { [DISTRIBUTION_SUMS]: sums(entries) }
  const changed = entries.map((entry, i) => (i === 0 ? { ...entry, sha256: "d".repeat(64) } : entry))
  expect(await evidence(await files(complete, changed, texts), entries)).toEqual([
    `The entries of ${DISTRIBUTION} are not the stage's entries`,
  ])
  expect(await evidence(await files(complete, entries.slice(1), texts), entries)).toEqual([
    `The entries of ${DISTRIBUTION} are not the stage's entries`,
  ])
})

test("an empty stage is refused", async () => {
  expect(await evidence([], entries)).toEqual(["The stage holds no distribution evidence"])
})

test("a tampered checksum file is refused", async () => {
  const tampered = sums(entries).replace("a".repeat(64), "e".repeat(64))
  const problems = await evidence(await files(complete, entries, { [DISTRIBUTION_SUMS]: tampered }), entries)
  expect(problems).toEqual([
    `${DISTRIBUTION_SUMS} has sha256 ${hash(tampered)}; the entries give ${hash(sums(entries))}`,
  ])
})

test("a tampered sidecar is refused", async () => {
  const problems = await evidence(await files(complete, entries, { [npm]: '{"name":"other"}\n' }), entries)
  expect(problems).toEqual([`${npm} has sha256 ${hash('{"name":"other"}\n')}; its entry records ${hash(sidecar(npm))}`])
})

test("a sidecar whose entry records no sha256 is refused", async () => {
  const missing = entries.map((entry, i) => (i === 1 ? { ...entry, sbomSha256: undefined } : entry))
  expect(await evidence(await files(complete, missing), missing)).toEqual([
    `${oci}: the entry records no sha256 for its sidecar`,
  ])
})
