#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"
import { applyPackageNameTransforms } from "../transforms/package-names"
import { applyExtensionTransforms } from "../transforms/transform-extensions"
import { transformI18nContent } from "../transforms/transform-i18n"
import { applyScriptTransforms } from "../transforms/transform-scripts"
import { applyBrandingTransforms } from "../transforms/transform-take-theirs"
import { applyWebTransforms } from "../transforms/transform-web"
import { warn, info } from "./logger"
import { compareVersions, parseVersion, type VersionInfo } from "./version"
import { isAncestor } from "./git"

const url = "https://github.com/anomalyco/opencode.git"
const workflows = [".github/workflows/publish.yml", ".github/workflows/beta.yml"]

/**
 * Repo-relative path of the file that records the last merged upstream tag.
 * Single line containing the upstream tag (e.g. `v1.14.33`).
 */
export const versionFile = ".opencode-version"

export async function root() {
  return (await $`git rev-parse --show-toplevel`.text()).trim()
}

export function normalize(root: string, file: string) {
  if (path.isAbsolute(file)) throw new Error("File must be relative to the repo root")
  if (file.includes("\0")) throw new Error("File path contains a null byte")

  const abs = path.resolve(root, file)
  const rel = path.relative(root, abs).replaceAll(path.sep, "/")

  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("File must stay inside the repo")
  return rel
}

export async function remote() {
  const result = await $`git remote get-url upstream`.quiet().nothrow()
  if (result.exitCode === 0) return "upstream"

  warn(`No 'upstream' remote found; using ${url}`)
  return url
}

export async function last(): Promise<VersionInfo> {
  const recorded = await readVersionFile()
  if (recorded) return recorded

  const source = await remote()

  info(`Fetching upstream tags from ${source}...`)
  const fetch = await $`git fetch ${source} --tags --force`.quiet().nothrow()
  if (fetch.exitCode !== 0) throw new Error(`Failed to fetch upstream: ${fetch.stderr.toString()}`)

  const items = await versions(source)
  for (const version of items) {
    if (await isAncestor(version.commit, "HEAD")) return version
  }

  throw new Error("Could not find a merged upstream tag in HEAD")
}

/**
 * Read the recorded last-merged upstream tag from `.opencode-version`. Returns
 * null if the file is missing/empty, or if the recorded tag cannot be resolved
 * to a commit (e.g. tags have not been fetched yet). Falls back to the
 * isAncestor-based discovery in `last()`.
 */
async function readVersionFile(): Promise<VersionInfo | null> {
  const repo = await root()
  const file = Bun.file(`${repo}/${versionFile}`)
  if (!(await file.exists())) return null

  const tag = (await file.text()).trim()
  if (!tag) return null

  const version = parseVersion(tag)
  if (!version) {
    warn(`${versionFile} contains '${tag}' which is not a valid version tag; ignoring`)
    return null
  }

  const commit = await resolveTag(tag)
  if (!commit) return null

  return { version, tag, commit }
}

async function resolveTag(tag: string): Promise<string | null> {
  const local = await $`git rev-parse --verify --quiet ${tag}^{commit}`.quiet().nothrow()
  if (local.exitCode === 0) return local.stdout.toString().trim()

  const source = await remote()
  info(`Tag ${tag} not present locally; fetching from ${source}...`)
  const fetch = await $`git fetch ${source} tag ${tag} --no-tags`.quiet().nothrow()
  if (fetch.exitCode !== 0) {
    warn(`Failed to fetch tag ${tag}: ${fetch.stderr.toString()}`)
    return null
  }

  const after = await $`git rev-parse --verify --quiet ${tag}^{commit}`.quiet().nothrow()
  return after.exitCode === 0 ? after.stdout.toString().trim() : null
}

/**
 * Record the merged upstream tag in `.opencode-version` so subsequent runs of
 * `last()` resolve instantly without an `ls-remote` walk.
 */
export async function writeVersion(tag: string): Promise<string> {
  const repo = await root()
  const dest = `${repo}/${versionFile}`
  await Bun.write(dest, `${tag}\n`)
  return dest
}

export async function versions(source: string): Promise<VersionInfo[]> {
  const result = await $`git ls-remote --tags ${source}`.quiet().nothrow()
  if (result.exitCode !== 0) throw new Error(`Failed to list upstream tags: ${result.stderr.toString()}`)

  const found = new Map<string, string>()
  for (const line of result.stdout.toString().trim().split("\n")) {
    const match = line.match(/^([a-f0-9]+)\s+refs\/tags\/([^^]+)(\^\{\})?$/)
    if (!match) continue

    const commit = match[1]
    const tag = match[2]
    const peeled = Boolean(match[3])
    if (commit && tag && (peeled || !found.has(tag))) found.set(tag, commit)
  }

  return [...found]
    .flatMap(([tag, commit]) => {
      const version = parseVersion(tag)
      return version ? [{ version, tag, commit }] : []
    })
    .sort((a, b) => compareVersions(b.version, a.version))
}

export async function upstream(ref: string, file: string) {
  const data = await upstreamData(ref, file)
  return data === null ? null : data.toString()
}

export async function upstreamData(ref: string, file: string) {
  const spec = `${ref}:${file}`
  const result = await $`git show ${spec}`.quiet().nothrow()
  if (result.exitCode === 0) return result.stdout

  const stderr = result.stderr.toString()
  if (stderr.includes("exists on disk") || stderr.includes("does not exist") || stderr.includes("Path")) return null
  throw new Error(`Failed to read ${file} from ${ref}: ${stderr}`)
}

/**
 * Batch-look up upstream blob sizes for many files in one subprocess. Returns
 * a map keyed by the input file path. Missing files map to `null`. Avoids
 * per-file `git show` spawns and keeps memory bounded when most candidates are
 * missing upstream or above a size threshold.
 */
export async function upstreamSizes(ref: string, files: string[]): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>()
  if (files.length === 0) return result

  const proc = Bun.spawn(["git", "cat-file", "--batch-check"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const input = files.map((f) => `${ref}:${f}\n`).join("")
  proc.stdin.write(input)
  await proc.stdin.end()

  const stdout = await new Response(proc.stdout).text()
  const lines = stdout.split("\n").filter((line) => line.length > 0)
  for (let i = 0; i < files.length; i++) {
    const line = lines[i] ?? ""
    if (line.includes(" missing")) {
      result.set(files[i], null)
      continue
    }
    const parts = line.trim().split(/\s+/)
    const size = Number(parts[2] ?? "")
    result.set(files[i], Number.isFinite(size) ? size : null)
  }
  return result
}

export async function translate(file: string, text: string) {
  const names = applyPackageNameTransforms(text).result
  const script = applyScriptTransforms(names).result
  const branded = applyBrandingTransforms(script).result
  const i18n = transformI18nContent(branded).result
  const ext = applyExtensionTransforms(i18n, file).result
  const web = applyWebTransforms(ext).result

  return workflow(file, web)
}

function workflow(file: string, text: string) {
  if (!workflows.includes(file)) return text
  return text
    .replace(/github\.repository == 'anomalyco\/opencode'/g, "github.repository == 'Kilo-Org/kilocode'")
    .replace(/github\.repository == "anomalyco\/opencode"/g, 'github.repository == "Kilo-Org/kilocode"')
    .replace(/\bopencode-ai\b/g, "@kilocode/cli")
    .replace(
      /GH_REPO:\s*\$\{\{ \(github\.ref_name == 'beta' && 'anomalyco\/opencode-beta'\) \|\| github\.repository \}\}/g,
      "GH_REPO: ${{ github.repository }}",
    )
}
