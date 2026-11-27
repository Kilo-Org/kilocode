#!/usr/bin/env bun
// kilocode_change - new file
/**
 * Publishes the GitHub release in the release-undraft job of .github/workflows/publish.yml, after
 * publish-build pushed the images and wrote the distribution evidence and before publish puts the
 * packages on npm: the installer and `kilo upgrade` take the version from npm and download the
 * archives from the release, so the release is public first.
 *
 *   bun script/kilocode/release-undraft.ts <publish-build artifact directory>
 *
 * Environment: VERSION, PRE_RELEASE, KILO_PUBLISH_SHA256 (publish-build's output), KILO_RELEASE,
 * GH_REPO, GH_TOKEN, CLI_MANIFEST_SHA256 and VSIX_SHA256 (see draft-assets.ts).
 *
 * Before anything is uploaded, the evidence of the stage must be the distribution evidence and
 * nothing else (evidence()): the manifest, its checksum file and exactly the sidecars its entries
 * name, with the manifest's entries equal to the stage's. Each sidecar must have the sha256 its
 * entry records, and the checksum file must be the one those entries give. Distribution evidence that an earlier
 * attempt left on the draft is deleted (listed by name, not downloaded). The draft then gets the
 * evidence, is checked complete once and is published with its notes (draft-assets.ts publish()).
 * A release that is already published (a re-run) is only checked, together with the npm tarballs
 * the stage names (recheck()). The job installs nothing: this script imports only Bun and Node
 * built-ins and this repository's code.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import * as KiloDraft from "./draft-assets.ts"
import * as Stage from "./publish-stage.ts"
import { assets, remove } from "./release.ts"
import { digest } from "./sbom/artifact.ts"
import type { Entry } from "./sbom/manifest.ts"

/** Problems of the stage's evidence files, by their paths, against the stage's entries. */
export async function evidence(files: string[], entries: Entry[]) {
  if (files.length === 0) return ["The stage holds no distribution evidence"]
  const names = files.map((file) => path.basename(file))
  const problems = names
    .filter((name) => !KiloDraft.distribution(name))
    .map((name) => `${name} is not distribution evidence`)
  if (new Set(names).size !== names.length) problems.push("The stage names an evidence file twice")
  for (const name of [KiloDraft.DISTRIBUTION, KiloDraft.DISTRIBUTION_SUMS]) {
    if (!names.includes(name)) problems.push(`${name} is missing from the stage`)
  }
  const sidecars = names
    .filter((name) => name !== KiloDraft.DISTRIBUTION && name !== KiloDraft.DISTRIBUTION_SUMS)
    .sort()
  const named = entries.flatMap((entry) => (entry.sbom ? [entry.sbom] : [])).sort()
  if (sidecars.join("\n") !== named.join("\n")) {
    problems.push(`The sidecars [${sidecars.join(", ")}] are not the ones the entries name [${named.join(", ")}]`)
  }
  const file = (name: string) => files[names.indexOf(name)]
  for (const entry of entries) {
    if (!entry.sbom) continue
    if (!/^[0-9a-f]{64}$/.test(entry.sbomSha256 ?? "")) {
      problems.push(`${entry.sbom}: the entry records no sha256 for its sidecar`)
      continue
    }
    const sidecar = file(entry.sbom)
    if (!sidecar) continue
    const actual = await digest(sidecar)
    if (actual !== entry.sbomSha256)
      problems.push(`${entry.sbom} has sha256 ${actual}; its entry records ${entry.sbomSha256}`)
  }
  // sums() needs every sidecar's sha256; a missing one is reported above.
  const sums = file(KiloDraft.DISTRIBUTION_SUMS)
  if (sums && entries.every((entry) => !entry.sbom || /^[0-9a-f]{64}$/.test(entry.sbomSha256 ?? ""))) {
    const expected = KiloDraft.sums(entries)
    const actual = await digest(sums)
    if (actual !== expected) {
      problems.push(`${KiloDraft.DISTRIBUTION_SUMS} has sha256 ${actual}; the entries give ${expected}`)
    }
  }
  const manifest = files[names.indexOf(KiloDraft.DISTRIBUTION)]
  if (manifest) {
    const order = (list: Entry[]) => JSON.stringify([...list].sort((a, b) => a.artifact.localeCompare(b.artifact)))
    const parsed: { entries?: Entry[] } = JSON.parse(await readFile(manifest, "utf8"))
    if (order(parsed.entries ?? []) !== order(entries)) {
      problems.push(`The entries of ${KiloDraft.DISTRIBUTION} are not the stage's entries`)
    }
  }
  return problems
}

if (import.meta.main) {
  const dir = process.argv[2]
  const { VERSION, PRE_RELEASE, KILO_PUBLISH_SHA256 } = process.env
  if (!dir || !VERSION || !KILO_PUBLISH_SHA256) {
    throw new Error("Usage: VERSION=… KILO_PUBLISH_SHA256=… release-undraft.ts <publish-build directory>")
  }
  const stage = await Stage.read({ stage: dir, digest: KILO_PUBLISH_SHA256, version: VERSION, need: "evidence" })
  const { id, draft } = await KiloDraft.open(VERSION)
  if (draft) {
    const problems = await evidence(stage.files, stage.entries)
    if (problems.length > 0) {
      throw new Error(`The stage's evidence is refused. Nothing was uploaded.\n${problems.join("\n")}`)
    }
    for (const item of await assets(id)) {
      if (!KiloDraft.distribution(item.name)) continue
      console.log(`Removing ${item.name}, left on the draft by an earlier attempt`)
      await remove(item.id!)
    }
    await KiloDraft.publish({
      version: VERSION,
      prerelease: PRE_RELEASE === "true",
      files: stage.files,
      entries: stage.entries,
    })
  } else {
    await KiloDraft.recheck({ version: VERSION, entries: stage.entries })
  }
}
