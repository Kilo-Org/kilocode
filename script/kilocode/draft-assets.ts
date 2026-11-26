import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { digest } from "./sbom/artifact.ts"
import type { Manifest } from "./sbom/manifest.ts"

// The publish job runs this before it un-drafts the release. The draft must hold exactly
// the assets upload-cli checked against the build manifest, with the Windows zips and the
// checksum file that sign-cli-windows replaced. Every expected digest comes from files the
// job already checked (the manifest in the signed CLI tarball) or from job outputs.

const MANIFEST = "cli-sbom-evidence.json"
const SUMS = "kilo-cli-SHA256SUMS"

/** Parses the `<sha256>  <zip>` lines sign-cli-windows records for the zips it uploads (LF or CRLF). */
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

/**
 * The checksum file after sign-cli-windows replaced the Windows zips: each zip line carries the
 * signed digest, every other byte is unchanged. sign-cli-windows writes the same text.
 */
export function sums(text: string, zips: Map<string, string>) {
  const lines = text.split("\n")
  for (const name of zips.keys()) {
    const count = lines.filter((line) => line.endsWith(`  ${name}`)).length
    if (count !== 1) throw new Error(`${name} is listed ${count} times in ${SUMS}`)
  }
  return lines
    .map((line) => {
      const match = /^[0-9a-f]{64} {2}(.+)$/.exec(line)
      const sha = match ? zips.get(match[1]) : undefined
      return sha ? `${sha}  ${match![1]}` : line
    })
    .join("\n")
}

/** Returns one message per missing, extra or mismatched draft asset. */
export async function check(input: { draft: string; dist: string; signed: string }) {
  const zips = signed(input.signed)
  const data: Manifest = JSON.parse(await readFile(path.join(input.dist, MANIFEST), "utf8"))
  const windows = data.entries.map((entry) => entry.artifact).filter((name) => name.startsWith("kilo-windows-"))
  const problems: string[] = []
  for (const name of windows) if (!zips.has(name)) problems.push(`${name}: sign-cli-windows recorded no signed digest`)
  for (const name of zips.keys()) if (!windows.includes(name)) problems.push(`${name}: not in the build manifest`)
  if (problems.length) return problems.sort()

  const expected = new Map<string, string>()
  for (const entry of data.entries) {
    expected.set(entry.artifact, zips.get(entry.artifact) ?? entry.sha256)
    if (entry.sbom) expected.set(entry.sbom, entry.sbomSha256 ?? "")
  }
  expected.set(MANIFEST, await digest(path.join(input.dist, MANIFEST)))
  const text = sums(await readFile(path.join(input.dist, SUMS), "utf8"), zips)
  expected.set(SUMS, createHash("sha256").update(text).digest("hex"))

  const draft = await readdir(input.draft, { withFileTypes: true })
  const names = new Set<string>()
  for (const file of draft) {
    names.add(file.name)
    const want = expected.get(file.name)
    if (want === undefined) {
      problems.push(`${file.name}: not expected on the draft`)
      continue
    }
    if (!file.isFile()) {
      problems.push(`${file.name}: not a regular file`)
      continue
    }
    const got = await digest(path.join(input.draft, file.name))
    if (!/^[0-9a-f]{64}$/.test(want) || got !== want)
      problems.push(`${file.name}: digest ${got}, expected ${want || "none"}`)
  }
  for (const name of expected.keys()) if (!names.has(name)) problems.push(`${name}: missing from the draft`)
  return problems.sort()
}

if (import.meta.main) {
  const [draft, dist] = process.argv.slice(2)
  const problems = await check({ draft, dist, signed: process.env.SIGNED_ZIPS ?? "" }).catch((err: Error) => [
    err.message,
  ])
  for (const problem of problems) console.log(`::error::${problem}`)
  if (problems.length) {
    console.log(
      `The draft release does not hold the checked assets (${problems.length} problem(s)). Nothing was published.`,
    )
    process.exit(1)
  }
  console.log(`The draft release holds exactly the ${(await readdir(draft)).length} checked assets.`)
}
