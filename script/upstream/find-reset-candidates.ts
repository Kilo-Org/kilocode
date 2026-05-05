#!/usr/bin/env bun
/**
 * Find files whose drift from the last merged upstream is insignificant and
 * (optionally) reset them back to upstream.
 *
 * Starts from `git diff --name-only <upstream-commit>..HEAD` to pre-filter the
 * working tree, then classifies each candidate:
 *
 *   - identical           : local bytes already match transformed upstream
 *   - markers-only        : only diff is kilocode_change markers wrapping
 *                           identical code (stale markers)
 *   - whitespace-only     : only diff is whitespace
 *   - small-diff          : <= --review-limit non-marker diff lines
 *   - large-diff          : > --review-limit non-marker diff lines (skipped)
 *   - upstream-missing    : file does not exist upstream (kilo-only, skipped)
 *   - local-missing       : file tracked by git but missing locally (skipped)
 *   - binary-identical    : binary file already matches (skipped)
 *   - binary-diff         : binary file differs (skipped; use reset-to-upstream.ts
 *                           per file if you want to reset binaries)
 *
 * markers-only, whitespace-only, and small-diff buckets are auto-reset unless
 * --dry-run is passed. A markdown summary is printed to stdout at the end so
 * you can review what happened and spot-check the resulting `git diff`.
 *
 * Usage:
 *   bun run script/upstream/find-reset-candidates.ts
 *   bun run script/upstream/find-reset-candidates.ts packages/opencode/src/agent
 *   bun run script/upstream/find-reset-candidates.ts --dry-run --review-limit 3
 */

import { $ } from "bun"
import { defaultConfig } from "./utils/config"
import { error, header, info, success, warn } from "./utils/logger"
import { matches } from "./utils/match"
import { classifyDrift, resetFile, type Bucket, type ClassifyResult } from "./utils/reset"
import { last, normalize, root, upstreamSizes } from "./utils/upstream"

interface Args {
  scope?: string
  reviewLimit: number
  dryRun: boolean
  concurrency: number
  help: boolean
}

interface Entry extends ClassifyResult {
  file: string
  reset?: boolean
}

const KILO_ONLY_PATHSPECS = [
  ":(exclude,glob)packages/kilo-*/**",
  ":(exclude,glob)**/kilocode/**",
  ":(exclude)script/upstream",
]

// Non-code assets never make sense to bulk-reset. Big binary-ish files (large
// SVG sprites, icons, fonts, archives) also stress concurrent git subprocesses
// and hide real drift in the report. Use reset-to-upstream.ts per file if you
// really want to restore one of these.
const SKIP_EXTENSIONS = new Set([
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".br",
  ".wasm",
  ".bin",
  ".db",
  ".sqlite",
  ".mp3",
  ".mp4",
  ".mov",
  ".pdf",
])

const SKIP_FILENAMES = new Set(["bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock"])

// Cap the blob size we'll classify. Generated manifests (models-snapshot.ts,
// openapi.json), media bundled in upstream-only packages (MP4s, PNGs), etc.
// are not meaningful reset candidates and big git show outputs can stall Bun
// subprocesses under concurrency.
const MAX_SIZE = 256 * 1024

const RESET_BUCKETS = new Set<Bucket>(["markers-only", "cosmetic-only", "small-diff"])

const BUCKET_ORDER: Bucket[] = [
  "markers-only",
  "cosmetic-only",
  "small-diff",
  "large-diff",
  "identical",
  "binary-diff",
  "binary-identical",
  "too-large",
  "upstream-missing",
  "local-missing",
]

function usage() {
  console.log(`Usage: bun run script/upstream/find-reset-candidates.ts [path] [options]

Arguments:
  path                     Optional repo-relative subdirectory to scope to.
                           Defaults to all tracked shared paths.

Options:
  --review-limit <n>       Max non-marker diff lines that still auto-resets
                           (default: 5).
  --dry-run                Classify and report only; do not write any files.
  --concurrency <n>        Parallel classifications (default: 8).
  --help                   Show this help message.`)
}

function args(): Args {
  const raw = process.argv.slice(2)
  const skip = new Set<number>()

  const flagValue = (names: string[]) => {
    const idx = raw.findIndex((a) => names.includes(a) || names.some((n) => a.startsWith(`${n}=`)))
    if (idx === -1) return undefined
    skip.add(idx)
    const arg = raw[idx]
    if (arg.includes("=")) return arg.slice(arg.indexOf("=") + 1)
    skip.add(idx + 1)
    return raw[idx + 1]
  }

  const reviewRaw = flagValue(["--review-limit"])
  const reviewLimit = reviewRaw === undefined ? 5 : Number(reviewRaw)
  if (!Number.isFinite(reviewLimit) || reviewLimit < 0) {
    throw new Error("--review-limit requires a non-negative number")
  }

  const concurrencyRaw = flagValue(["--concurrency"])
  const concurrency = concurrencyRaw === undefined ? 8 : Number(concurrencyRaw)
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency requires a positive integer")
  }

  const positional = raw.filter((a, i) => !skip.has(i) && !a.startsWith("--"))
  if (positional.length > 1) throw new Error(`Unexpected extra arguments: ${positional.slice(1).join(" ")}`)

  return {
    scope: positional[0],
    reviewLimit,
    concurrency,
    dryRun: raw.includes("--dry-run"),
    help: raw.includes("--help") || raw.includes("-h"),
  }
}

interface CandidateSet {
  files: string[]
  skippedAssets: string[]
  skippedPolicy: string[]
}

async function candidates(commit: string, scope: string | undefined, top: string): Promise<CandidateSet> {
  const pathspecs = [scope ?? ".", ...KILO_ONLY_PATHSPECS]
  const result = await $`git diff --name-only ${commit}..HEAD -- ${pathspecs}`.cwd(top).quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list candidate files: ${result.stderr.toString()}`)
  }
  const all = result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const files: string[] = []
  const skippedAssets: string[] = []
  const skippedPolicy: string[] = []
  for (const file of all) {
    if (asset(file)) {
      skippedAssets.push(file)
      continue
    }
    if (policyExempt(file)) {
      skippedPolicy.push(file)
      continue
    }
    files.push(file)
  }
  return { files, skippedAssets, skippedPolicy }
}

/**
 * Files the upstream merge config marks as "keep ours" (Kilo-specific preserved
 * versions) or "skip" (upstream-only, removed in Kilo) should never be touched
 * by the bulk resetter. They show up in `git diff` against raw upstream but
 * resetting them would undo deliberate Kilo decisions.
 */
function policyExempt(file: string): boolean {
  if (matches(file, defaultConfig.keepOurs)) return true
  if (matches(file, defaultConfig.skipFiles)) return true
  return false
}

function asset(file: string): boolean {
  const base = file.slice(file.lastIndexOf("/") + 1)
  if (SKIP_FILENAMES.has(base)) return true
  const dot = base.lastIndexOf(".")
  if (dot === -1) return false
  return SKIP_EXTENSIONS.has(base.slice(dot).toLowerCase())
}

async function concurrent<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx], idx)
    }
  }
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker)
  await Promise.all(workers)
  return results
}

function group(entries: Entry[]): Map<Bucket, Entry[]> {
  const out = new Map<Bucket, Entry[]>()
  for (const entry of entries) {
    const bucket = out.get(entry.bucket) ?? []
    bucket.push(entry)
    out.set(entry.bucket, bucket)
  }
  for (const bucket of out.values()) bucket.sort((a, b) => a.file.localeCompare(b.file))
  return out
}

function detail(entry: Entry): string {
  if (entry.lines === undefined) return ""
  if (entry.bucket === "too-large") return ` (${Math.round(entry.lines / 1024)} KB)`
  return ` (${entry.lines} line${entry.lines === 1 ? "" : "s"})`
}

function describe(bucket: Bucket, count: number, dryRun: boolean): { label: string; action: string } {
  if (bucket === "markers-only") return { label: `markers-only (${count})`, action: dryRun ? "would reset" : "reset" }
  if (bucket === "cosmetic-only")
    return { label: `cosmetic-only (${count})`, action: dryRun ? "would reset" : "reset" }
  if (bucket === "small-diff") return { label: `small-diff (${count})`, action: dryRun ? "would reset" : "reset" }
  if (bucket === "large-diff") return { label: `large-diff (${count})`, action: "skipped" }
  if (bucket === "identical") return { label: `identical (${count})`, action: "nothing to do" }
  if (bucket === "binary-diff") return { label: `binary-diff (${count})`, action: "skipped" }
  if (bucket === "binary-identical") return { label: `binary-identical (${count})`, action: "nothing to do" }
  if (bucket === "upstream-missing") return { label: `upstream-missing (${count})`, action: "skipped" }
  if (bucket === "too-large") return { label: `too-large (${count})`, action: "skipped" }
  return { label: `local-missing (${count})`, action: "skipped" }
}

function report(
  entries: Entry[],
  skippedAssets: string[],
  skippedPolicy: string[],
  dryRun: boolean,
  tag: string,
  commit: string,
  scope: string,
  limit: number,
) {
  const grouped = group(entries)
  const lines: string[] = []

  lines.push(`# Reset-to-upstream candidate report`)
  lines.push("")
  lines.push(`- Last merged upstream: **${tag}** (\`${commit.slice(0, 8)}\`)`)
  lines.push(`- Scope: \`${scope}\``)
  lines.push(`- Review limit: ${limit} non-marker diff line(s)`)
  lines.push(`- Mode: ${dryRun ? "dry-run (no writes)" : "auto-apply"}`)
  lines.push(`- Total candidates: ${entries.length}`)
  if (skippedAssets.length > 0) lines.push(`- Non-code assets skipped: ${skippedAssets.length}`)
  if (skippedPolicy.length > 0) lines.push(`- Config-protected files skipped: ${skippedPolicy.length}`)
  lines.push("")

  lines.push(`## Summary`)
  lines.push("")
  lines.push(`| Bucket | Count | Action |`)
  lines.push(`|---|---|---|`)
  for (const bucket of BUCKET_ORDER) {
    const items = grouped.get(bucket) ?? []
    if (items.length === 0) continue
    const info = describe(bucket, items.length, dryRun)
    lines.push(`| ${bucket} | ${items.length} | ${info.action} |`)
  }
  if (skippedAssets.length > 0) lines.push(`| non-code-asset | ${skippedAssets.length} | skipped |`)
  if (skippedPolicy.length > 0) lines.push(`| config-protected | ${skippedPolicy.length} | skipped |`)
  lines.push("")

  for (const bucket of BUCKET_ORDER) {
    const items = grouped.get(bucket) ?? []
    if (items.length === 0) continue
    const info = describe(bucket, items.length, dryRun)
    lines.push(`## ${info.label} — ${info.action}`)
    lines.push("")
    for (const entry of items) {
      const suffix = detail(entry)
      const note = entry.reset === false ? " [reset failed]" : ""
      lines.push(`- \`${entry.file}\`${suffix}${note}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

async function main() {
  const opts = args()
  if (opts.help) {
    usage()
    return
  }

  const top = await root()
  process.chdir(top)

  const scope = opts.scope ? normalize(top, opts.scope) : undefined

  header("Find reset-to-upstream candidates")

  const version = await last()
  success(`Last merged upstream: ${version.tag} (${version.commit.slice(0, 8)})`)

  info(`Scope: ${scope ?? "(all shared paths)"}`)
  info(`Review limit: ${opts.reviewLimit} non-marker diff line(s)`)
  info(`Mode: ${opts.dryRun ? "dry-run" : "auto-apply"}`)

  const { files, skippedAssets, skippedPolicy } = await candidates(version.commit, scope, top)
  if (skippedAssets.length > 0) info(`Skipping ${skippedAssets.length} non-code asset(s)`)
  if (skippedPolicy.length > 0) info(`Skipping ${skippedPolicy.length} file(s) protected by keepOurs/skipFiles config`)
  if (files.length === 0) {
    success("No code files differ from upstream in scope. Nothing to do.")
    return
  }
  info(`Candidate files: ${files.length}`)

  // Batch-check upstream sizes in one subprocess. Pre-bucket absent and oversized
  // files so we don't spawn `git show` for a 16 MB .mp4 that would stall under
  // concurrency anyway.
  info(`Checking upstream blob sizes...`)
  const sizes = await upstreamSizes(version.commit, files)
  const classifyQueue: string[] = []
  const preBucketed: Entry[] = []
  for (const file of files) {
    const size = sizes.get(file)
    if (size === null || size === undefined) {
      preBucketed.push({ file, bucket: "upstream-missing" })
      continue
    }
    if (size > MAX_SIZE) {
      preBucketed.push({ file, bucket: "too-large", lines: size })
      continue
    }
    classifyQueue.push(file)
  }
  if (preBucketed.length > 0) info(`Pre-bucketed ${preBucketed.length} (missing or too-large)`)
  info(`Classifying ${classifyQueue.length} file(s)...`)

  const classified = await concurrent(classifyQueue, opts.concurrency, async (file, i) => {
    const result = await classifyDrift({
      root: top,
      file,
      commit: version.commit,
      reviewLimit: opts.reviewLimit,
    })
    if ((i + 1) % 50 === 0 || i === classifyQueue.length - 1) {
      info(`Classified ${i + 1}/${classifyQueue.length}`)
    }
    return { file, ...result } as Entry
  })
  const entries = [...preBucketed, ...classified]

  if (!opts.dryRun) {
    const resets = entries.filter((e) => RESET_BUCKETS.has(e.bucket))
    if (resets.length > 0) info(`Resetting ${resets.length} file(s) to upstream...`)
    await concurrent(resets, opts.concurrency, async (entry) => {
      const result = await resetFile({ root: top, file: entry.file, commit: version.commit })
      entry.reset = result.action !== "skipped"
      if (result.action === "skipped") warn(`Skipped ${entry.file}: ${result.reason ?? "unknown"}`)
    })
  }

  console.log("")
  console.log(
    report(
      entries,
      skippedAssets,
      skippedPolicy,
      opts.dryRun,
      version.tag,
      version.commit,
      scope ?? "(all shared paths)",
      opts.reviewLimit,
    ),
  )
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
