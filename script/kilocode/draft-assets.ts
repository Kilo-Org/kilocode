import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assets, download, release, remove, upload, type Asset } from "./release.ts"
import { publishNotes } from "./release-notes.ts"
import { digest } from "./sbom/artifact.ts"
import type { Manifest } from "./sbom/manifest.ts"

// The release is published (un-drafted) only after every asset is on the draft, so that the
// published release never changes afterwards. Before that, the draft must hold exactly the
// expected assets, each bound to a digest recorded by the job that produced it:
// - the CLI archives, sidecars and checksum file listed by the evidence manifest, whose digest
//   sbom-cli-windows recorded (CLI_MANIFEST_SHA256; upload-cli checked every entry against it)
// - the VS Code packages and their evidence that build-vscode listed (VSIX_SHA256)
// - the distribution evidence the publish script itself produced and uploaded
// Every request addresses the release by its database id (KILO_RELEASE).

const MANIFEST = "cli-sbom-evidence.json"
const SUMS = "kilo-cli-SHA256SUMS"
const DISTRIBUTION = "cli-distribution-sbom-evidence.json"
const DISTRIBUTION_SUMS = "kilo-cli-distribution-SHA256SUMS"

/** Names of the distribution evidence: its manifest, checksum file and npm and image sidecars. */
export function distribution(name: string) {
  return (
    name === DISTRIBUTION ||
    name === DISTRIBUTION_SUMS ||
    /^kilocode-[a-z0-9.-]+\.tgz\.cdx\.json$/.test(name) ||
    /^kilo-oci-[a-z0-9-]+@[0-9a-f]{12}\.cdx\.json$/.test(name)
  )
}

/** Parses `<sha256>  <file>` lines, as `shasum -a 256` prints them (LF or CRLF). */
export function list(text: string, source: string) {
  const files = new Map<string, string>()
  for (const line of text.split(/\r\n|\n|\r/).filter((item) => item.trim() !== "")) {
    const match = /^([0-9a-f]{64}) {2}([^/\\]+)$/.exec(line)
    if (!match) throw new Error(`Invalid digest line from ${source}: ${JSON.stringify(line)}`)
    if (files.has(match[2])) throw new Error(`${match[2]} is listed twice by ${source}`)
    files.set(match[2], match[1])
  }
  if (files.size === 0) throw new Error(`${source} recorded no digests`)
  return files
}

/**
 * Digest of the `SHA256SUMS` text of a manifest, as `Manifest.checksums` writes it. Every
 * sidecar must have a recorded digest: the fallback `Manifest.checksums` has for a missing one
 * (hashing the file beside it) has no recorded value to check against.
 */
function sums(entries: Manifest["entries"]) {
  const lines: string[] = []
  for (const entry of [...entries].sort((a, b) => a.artifact.localeCompare(b.artifact))) {
    if (entry.sha256) lines.push(`${entry.sha256}  ${entry.artifact}`)
    if (!entry.sbom) continue
    if (!/^[0-9a-f]{64}$/.test(entry.sbomSha256 ?? "")) throw new Error(`${entry.sbom}: the manifest records no digest`)
    lines.push(`${entry.sbomSha256}  ${entry.sbom}`)
  }
  const text = `${lines.join("\n")}\n`
  return createHash("sha256").update(text).digest("hex")
}

/** Returns one message per missing, extra or mismatched release asset. */
export async function check(input: {
  /** Every asset on the release, by name, with its SHA-256. */
  assets: Map<string, string>
  /** Reads the text of an asset (the evidence manifests). */
  read: (name: string) => Promise<string>
  /** SHA-256 of cli-sbom-evidence.json recorded by sbom-cli-windows. */
  manifest: string
  /** build-vscode's digest list of packages/kilo-vscode/out. */
  vsix: string
  /** Assets the publish script uploaded itself, by name and SHA-256. */
  extra?: Map<string, string>
  /**
   * A published release also holds the distribution evidence of the run that published it.
   * No job of a later run recorded its digests, so its sidecars and checksum file must match
   * the distribution manifest the release holds.
   */
  published?: boolean
}) {
  if (!/^[0-9a-f]{64}$/.test(input.manifest)) throw new Error("sbom-cli-windows recorded no CLI manifest digest")
  const actual = input.assets.get(MANIFEST)
  if (actual !== input.manifest) return [`${MANIFEST}: digest ${actual ?? "missing"}, expected ${input.manifest}`]

  const problems: string[] = []
  const expected = new Map<string, string>()
  const add = (name: string, sha: string) => {
    if (expected.has(name)) problems.push(`${name}: expected from two sources`)
    expected.set(name, sha)
  }
  // The manifest's digest is checked, so its entries name the CLI assets and their digests.
  const data: Manifest = JSON.parse(await input.read(MANIFEST))
  add(MANIFEST, input.manifest)
  for (const entry of data.entries) {
    add(entry.artifact, entry.sha256)
    if (entry.sbom) add(entry.sbom, entry.sbomSha256 ?? "")
  }
  add(SUMS, sums(data.entries))
  for (const [name, sha] of list(input.vsix, "build-vscode")) add(name, sha)
  for (const [name, sha] of input.extra ?? []) add(name, sha)
  if (input.published) {
    const own = input.assets.get(DISTRIBUTION)
    if (own === undefined) problems.push(`${DISTRIBUTION}: missing from the release`)
    else {
      const evidence: Manifest = JSON.parse(await input.read(DISTRIBUTION))
      add(DISTRIBUTION, own)
      for (const entry of evidence.entries) if (entry.sbom) add(entry.sbom, entry.sbomSha256 ?? "")
      add(DISTRIBUTION_SUMS, sums(evidence.entries))
    }
  }

  for (const [name, got] of input.assets) {
    const want = expected.get(name)
    if (want === undefined) problems.push(`${name}: not expected on the release`)
    else if (!/^[0-9a-f]{64}$/.test(want) || got !== want)
      problems.push(`${name}: digest ${got}, expected ${want || "none"}`)
  }
  for (const name of expected.keys()) if (!input.assets.has(name)) problems.push(`${name}: missing from the release`)
  return problems.sort()
}

/**
 * Reads the release with this id and fails unless it holds exactly the expected assets.
 * Draft assets are downloaded and hashed. A published release's assets carry the SHA-256
 * GitHub computed (the `digest` field), which is used when present; the manifests the check
 * reads are downloaded, and their bytes must have that digest.
 *
 * Returns the release and, for a published release, the distribution manifest the check
 * accepted: its asset id, digest and the parsed bytes that were checked.
 */
export async function verify(input: { tag: string; release: string; extra?: Map<string, string>; prune?: boolean }) {
  const target = await release(input.release, input.tag)
  let found = await assets(input.release)
  // Distribution evidence that an earlier, failed run left on the draft is uploaded again later;
  // the check before any package is published removes it so that it can expect the exact set.
  const stale = target.draft && input.prune ? found.filter((item) => distribution(item.name)) : []
  for (const item of stale) {
    console.log(`Removing ${item.name}, left on the draft by an earlier run`)
    await remove(item.id!)
  }
  if (stale.length) found = await assets(input.release)

  const dir = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "release-assets-"))
  try {
    const files = new Map<string, string>()
    const fetch = async (item: Asset) => {
      const file = path.join(dir, path.basename(item.name))
      if (!files.has(item.name)) {
        await download(item.id!, file)
        files.set(item.name, file)
      }
      return file
    }
    const actual = new Map<string, string>()
    const problems: string[] = []
    for (const item of found) {
      if (item.state && item.state !== "uploaded") problems.push(`${item.name}: not uploaded (state=${item.state})`)
      const published = /^sha256:[0-9a-f]{64}$/.test(item.digest ?? "") && !target.draft
      actual.set(item.name, published ? item.digest!.slice("sha256:".length) : await digest(await fetch(item)))
    }
    const texts = new Map<string, string>()
    const read = async (name: string) => {
      const file = await fetch(found.find((item) => item.name === name)!)
      const got = await digest(file)
      if (got !== actual.get(name))
        throw new Error(`${name}: downloaded bytes have digest ${got}, the release lists ${actual.get(name)}`)
      const text = await readFile(file, "utf8")
      texts.set(name, text)
      return text
    }
    problems.push(
      ...(await check({
        assets: actual,
        read,
        manifest: process.env.CLI_MANIFEST_SHA256 ?? "",
        vsix: process.env.VSIX_SHA256 ?? "",
        extra: input.extra,
        published: !target.draft,
      }).catch((err: Error) => [err.message])),
    )
    for (const problem of problems) console.log(`::error::${problem}`)
    const label = `${target.draft ? "draft" : "published"} release ${input.tag} (${input.release})`
    if (problems.length)
      throw new Error(`The ${label} does not hold the checked assets (${problems.length} problem(s)).`)
    console.log(`The ${label} holds exactly the ${actual.size} checked assets.`)
    const own = found.find((item) => item.name === DISTRIBUTION)
    const text = texts.get(DISTRIBUTION)
    if (target.draft || !own || text === undefined) return { release: target, distribution: undefined }
    const manifest: Manifest = JSON.parse(text)
    return { release: target, distribution: { id: own.id!, digest: actual.get(DISTRIBUTION)!, manifest } }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The release with id KILO_RELEASE, which must be the release for `version`. */
export async function open(version: string) {
  const id = process.env.KILO_RELEASE
  if (!id) throw new Error("KILO_RELEASE (the release id) is required")
  return { id, draft: (await release(id, `v${version}`)).draft }
}

/**
 * Uploads the publish script's own assets to the draft, checks the complete draft and only
 * then publishes the release with its notes. Nothing is uploaded to the release after this.
 *
 * Every npm tarball and image the distribution evidence names must carry its digest, even
 * when its SBOM failed: a later re-run checks the npm tarballs against these digests.
 */
export async function publish(input: {
  version: string
  prerelease: boolean
  files: string[]
  entries: Manifest["entries"]
}) {
  const missing = input.entries.filter((entry) => !/^[0-9a-f]{64}$/.test(entry.sha256)).map((entry) => entry.artifact)
  if (missing.length) throw new Error(`No digest for ${missing.join(", ")}. The release was not published.`)
  const tag = `v${input.version}`
  const { id } = await open(input.version)
  await upload({ tag, release: id, files: input.files })
  const extra = new Map<string, string>()
  for (const file of input.files) extra.set(path.basename(file), await digest(file))
  await verify({ tag, release: id, extra })
  await publishNotes({
    version: input.version,
    prerelease: input.prerelease,
    release: id,
    repo: process.env.GH_REPO,
    temp: process.env.RUNNER_TEMP,
  })
}

/**
 * A re-run after the release was published: checks the published assets and that the npm
 * tarballs this run would publish, or found published, are the ones its distribution evidence
 * names. Uploads nothing and does not touch the release.
 */
export async function recheck(input: { version: string; entries: Manifest["entries"] }) {
  const tag = `v${input.version}`
  const { id } = await open(input.version)
  // The distribution manifest whose bytes the check downloaded and accepted, not a second copy.
  const { distribution: own } = await verify({ tag, release: id })
  if (!own) throw new Error(`The published release ${tag} holds no checked distribution evidence.`)
  const recorded = new Map(own.manifest.entries.map((entry) => [entry.artifact, entry.sha256]))
  const problems: string[] = []
  for (const entry of input.entries.filter((item) => item.distribution === "npm")) {
    // No digest here: the version is already on npm and its registry tarball could not be fetched,
    // so this run publishes nothing for it (a tarball it packs always has a digest).
    if (!entry.sha256) {
      console.log(`::warning::${entry.artifact}: no digest for the published tarball; not compared`)
      continue
    }
    const want = recorded.get(entry.artifact)
    // A release published before every entry had to carry a digest can name a tarball without one.
    if (want !== undefined && !/^[0-9a-f]{64}$/.test(want)) {
      console.log(`::warning::${entry.artifact}: the published evidence records no digest; not compared`)
      continue
    }
    if (want === entry.sha256) continue
    problems.push(`${entry.artifact}: digest ${entry.sha256}, the published evidence names ${want ?? "nothing"}`)
  }
  for (const problem of problems) console.log(`::error::${problem}`)
  if (problems.length) throw new Error(`The npm tarballs are not the ones the published release ${tag} describes.`)
  console.log(
    `Release ${tag} (${id}) is already published; its assets and the npm tarballs match its evidence (asset ${own.id}, sha256 ${own.digest}).`,
  )
}

if (import.meta.main) {
  const [tag] = process.argv.slice(2)
  if (!tag) throw new Error("Usage: draft-assets.ts <tag>")
  const id = process.env.KILO_RELEASE ?? ""
  await verify({ tag, release: id, prune: true }).catch((err: Error) => {
    console.log(`${err.message} Nothing was published.`)
    process.exit(1)
  })
}
