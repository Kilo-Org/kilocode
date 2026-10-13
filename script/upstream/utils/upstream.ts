#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"
import { applyPackageNameTransforms } from "../transforms/package-names"
import { applyExtensionTransforms } from "../transforms/transform-extensions"
import { isI18nFile, transformI18nContent } from "../transforms/transform-i18n"
import { applyScriptTransforms } from "../transforms/transform-scripts"
import { applyBrandingTransforms } from "../transforms/transform-take-theirs"
import { applyWebTransforms } from "../transforms/transform-web"
import { defaultConfig, type MergeConfig } from "./config"
import { warn } from "./logger"
import { isAncestor } from "./git"
import { compareVersions, parseVersion } from "./version"

export interface Pin {
  /** Upstream tag of the release, or `initial` for the base that `v2` was created from */
  tag: string
  /** Upstream release commit */
  commit: string
}

/** Subject of a sync merge commit, for example `chore(upstream): sync v2.0.27 (4d9678a79d6)` */
export function syncMessage(tag: string, commit: string) {
  return `chore(upstream): sync ${tag} (${commit.slice(0, 11)})`
}

const SYNC = /^chore\(upstream\): sync (v\d+\.\d+\.\d+) \(([0-9a-f]{7,40})\)/

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

export async function remote(config: MergeConfig = defaultConfig) {
  const result = await $`git remote get-url ${config.upstreamRemote}`.quiet().nothrow()
  if (result.exitCode === 0) return config.upstreamRemote

  warn(`No '${config.upstreamRemote}' remote found; using ${config.upstreamUrl}`)
  return config.upstreamUrl
}

/**
 * The upstream release commit that `ref` is pinned to: the second parent of the newest sync merge
 * (`chore(upstream): sync v2.x.y (<sha>)`) in its history, or `initialBase` before the first sync.
 * It needs no network and no upstream remote, so CI can use it with a full clone.
 */
export async function pinned(ref = "HEAD", config: MergeConfig = defaultConfig): Promise<Pin> {
  const log = await $`git log --format=%H%x00%P%x00%s --grep=${"^chore(upstream): sync v"} ${ref}`.quiet().text()
  const syncs = log.split("\n").flatMap((line) => {
    const [, parents = "", subject = ""] = line.split("\0")
    const found = subject.match(SYNC)
    const commit = parents.split(" ").slice(1).find((parent) => found?.[2] && parent.startsWith(found[2]))
    const version = found?.[1] ? parseVersion(found[1]) : null
    if (!found?.[1] || !commit || !version) return []
    return [{ tag: found[1], commit, version }]
  })
  const newest = syncs.sort((a, b) => compareVersions(b.version, a.version))[0]
  if (newest) return { tag: newest.tag, commit: newest.commit }
  if (await isAncestor(config.initialBase, ref)) return { tag: "initial", commit: config.initialBase }
  // A history without the v2 base (for example a test repository): use the merge base with upstream.
  const base = await $`git merge-base ${ref} ${`${config.upstreamRemote}/${config.upstreamBranch}`}`.quiet().nothrow()
  if (base.exitCode === 0) return { tag: "merge-base", commit: base.stdout.toString().trim() }
  throw new Error(`No sync merge and no initial base ${config.initialBase.slice(0, 11)} in the history of ${ref}`)
}

/** Alias kept for the v1 per-file tools (`fix-kilocode-markers`, `reset-to-upstream`) */
export async function last(ref = "HEAD") {
  return pinned(ref)
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

/**
 * Apply the enabled Kilo transforms to upstream text, so that per-file tools compare like with like.
 * With the v2 defaults (package names and branding off) the text stays as upstream wrote it.
 */
export async function translate(file: string, text: string, config: MergeConfig = defaultConfig) {
  const names = config.transforms.packageNames ? applyPackageNameTransforms(text).result : text
  if (!config.transforms.branding) return names
  const script = applyScriptTransforms(names).result
  const branded = applyBrandingTransforms(script).result
  const i18n = transformI18nContent(branded, false, isI18nFile(file)).result
  const ext = applyExtensionTransforms(i18n, file).result
  return applyWebTransforms(ext).result
}
