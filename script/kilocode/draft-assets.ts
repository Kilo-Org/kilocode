import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { upload } from "./release.ts"
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

const exec = promisify(execFile)
const MANIFEST = "cli-sbom-evidence.json"
const SUMS = "kilo-cli-SHA256SUMS"

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

/** Returns one message per missing, extra or mismatched draft asset. */
export async function check(input: {
  /** Directory holding the downloaded draft assets. */
  draft: string
  /** SHA-256 of cli-sbom-evidence.json recorded by sbom-cli-windows. */
  manifest: string
  /** build-vscode's digest list of packages/kilo-vscode/out. */
  vsix: string
  /** Assets the publish script uploaded itself, by name and SHA-256. */
  extra?: Map<string, string>
}) {
  if (!/^[0-9a-f]{64}$/.test(input.manifest)) throw new Error("sbom-cli-windows recorded no CLI manifest digest")
  const file = path.join(input.draft, MANIFEST)
  const actual = await digest(file).catch(() => undefined)
  if (actual !== input.manifest) return [`${MANIFEST}: digest ${actual ?? "missing"}, expected ${input.manifest}`]

  const problems: string[] = []
  const expected = new Map<string, string>()
  const add = (name: string, sha: string) => {
    if (expected.has(name)) problems.push(`${name}: expected from two sources`)
    expected.set(name, sha)
  }
  // The manifest's digest is checked, so its entries name the CLI assets and their digests.
  const data: Manifest = JSON.parse(await readFile(file, "utf8"))
  add(MANIFEST, input.manifest)
  const sums: string[] = []
  for (const entry of [...data.entries].sort((a, b) => a.artifact.localeCompare(b.artifact))) {
    add(entry.artifact, entry.sha256)
    sums.push(`${entry.sha256}  ${entry.artifact}`)
    if (!entry.sbom) continue
    add(entry.sbom, entry.sbomSha256 ?? "")
    sums.push(`${entry.sbomSha256}  ${entry.sbom}`)
  }
  const text = `${sums.join("\n")}\n`
  add(SUMS, createHash("sha256").update(text).digest("hex"))
  for (const [name, sha] of list(input.vsix, "build-vscode")) add(name, sha)
  for (const [name, sha] of input.extra ?? []) add(name, sha)

  const draft = await readdir(input.draft, { withFileTypes: true })
  const names = new Set<string>()
  for (const item of draft) {
    names.add(item.name)
    const want = expected.get(item.name)
    if (want === undefined) {
      problems.push(`${item.name}: not expected on the draft`)
      continue
    }
    if (!item.isFile()) {
      problems.push(`${item.name}: not a regular file`)
      continue
    }
    const got = await digest(path.join(input.draft, item.name))
    if (!/^[0-9a-f]{64}$/.test(want) || got !== want)
      problems.push(`${item.name}: digest ${got}, expected ${want || "none"}`)
  }
  for (const name of expected.keys()) if (!names.has(name)) problems.push(`${name}: missing from the draft`)
  return problems.sort()
}

/** Downloads the draft release `tag` and fails unless it holds exactly the expected assets. */
export async function verify(input: { tag: string; extra?: Map<string, string> }) {
  const draft = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "draft-assets-"))
  try {
    // gh reads GH_REPO and the token from the environment.
    await exec("gh", ["release", "download", input.tag, "--dir", draft], { maxBuffer: 16 * 1024 * 1024 })
    const problems = await check({
      draft,
      manifest: process.env.CLI_MANIFEST_SHA256 ?? "",
      vsix: process.env.VSIX_SHA256 ?? "",
      extra: input.extra,
    }).catch((err: Error) => [err.message])
    for (const problem of problems) console.log(`::error::${problem}`)
    if (problems.length) {
      throw new Error(
        `The draft release ${input.tag} does not hold the checked assets (${problems.length} problem(s)).`,
      )
    }
    console.log(`The draft release ${input.tag} holds exactly the ${(await readdir(draft)).length} checked assets.`)
  } finally {
    await rm(draft, { recursive: true, force: true })
  }
}

/**
 * Uploads the publish script's own assets, checks the complete draft and only then publishes
 * the release with its notes. Nothing is uploaded to the release after this.
 */
export async function publish(input: { version: string; prerelease: boolean; files: string[] }) {
  const tag = `v${input.version}`
  await upload({ tag, files: input.files })
  const extra = new Map<string, string>()
  for (const file of input.files) extra.set(path.basename(file), await digest(file))
  await verify({ tag, extra })
  await publishNotes({
    version: input.version,
    prerelease: input.prerelease,
    repo: process.env.GH_REPO,
    temp: process.env.RUNNER_TEMP,
  })
}

if (import.meta.main) {
  const [tag] = process.argv.slice(2)
  if (!tag) throw new Error("Usage: draft-assets.ts <tag>")
  await verify({ tag }).catch((err: Error) => {
    console.log(`${err.message} Nothing was published.`)
    process.exit(1)
  })
}
