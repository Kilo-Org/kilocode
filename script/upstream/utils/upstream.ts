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
