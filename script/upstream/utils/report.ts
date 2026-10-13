#!/usr/bin/env bun
/**
 * Sync analysis and report for the Kilo v2 line.
 *
 * The analysis uses `git merge-tree`, so it shows the real conflicts of a merge without touching the
 * working tree or the index.
 */

import { $ } from "bun"
import path from "node:path"
import { defaultConfig, type MergeConfig } from "./config"
import { matches } from "./match"
import { isKiloOwned } from "./owned"
import { isLockFile } from "../transforms/lock-files"
import type { Lag, Release } from "./version"

export type Recommendation =
  | "keep-ours"
  | "skip"
  | "workflow"
  | "lock-file"
  | "package-transform"
  | "i18n-transform"
  | "take-theirs-transform"
  | "script-transform"
  | "extension-transform"
  | "web-transform"
  | "manual"

export interface ConflictFile {
  path: string
  /** Conflict type from git, for example `content` or `modify/delete` */
  kind: string
  type: "markdown" | "package" | "code" | "config" | "i18n" | "script" | "extension" | "web" | "workflow" | "other"
  recommendation: Recommendation
  reason: string
}

export interface Analysis {
  base: string
  target: string
  mergeBase: string
  /** Commits that the merge adds to the history of the base */
  commits: number
  /** Files that upstream changed since the merge base */
  changed: number
  harness: { files: number; insertions: number; deletions: number }
  conflicts: ConflictFile[]
  /** Workflow files that upstream added since the merge base */
  newWorkflows: string[]
  /** Shared files that Kilo patched and upstream also changed */
  sharedTouched: string[]
}

export interface SyncReport {
  timestamp: string
  release: Release
  baseBranch: string
  baseCommit: string
  mergeBranch: string
  analysis: Analysis
  lagBefore: Lag
  lagAfter: Lag
  /** Follow-up notes from the merge run (manual steps, tooling gaps) */
  notes: string[]
}

export function classifyFile(file: string): ConflictFile["type"] {
  if (file.startsWith(".github/workflows/")) return "workflow"
  if (/packages\/[^/]+\/src\/i18n\/[^/]+\.ts$/.test(file) && !file.endsWith("/index.ts")) return "i18n"
  if (file.startsWith("script/") || file.includes("/script/")) return "script"
  if (file.includes("packages/extensions/")) return "extension"
  if (file.startsWith("packages/web/src/content/docs/") && file.endsWith(".mdx")) return "web"
  if (file.endsWith(".md")) return "markdown"
  if (path.basename(file) === "package.json") return "package"
  if (/\.(ts|tsx|js|jsx)$/.test(file)) return "code"
  if (/\.(json|jsonc|yaml|yml|toml)$/.test(file)) return "config"
  return "other"
}

/**
 * Recommend how to resolve one conflicted file. Branding transforms are recommended only when
 * `config.transforms.branding` is on. A file whose Kilo side has `kilocode_change` markers is
 * always manual: the markers mean an intentional Kilo change.
 */
export function getRecommendation(
  file: string,
  config: MergeConfig = defaultConfig,
  ours?: string,
): { recommendation: Recommendation; reason: string } {
  if (matches(file, config.skipFiles)) return { recommendation: "skip", reason: "Kilo does not ship this upstream file" }
  if (matches(file, config.keepOurs)) return { recommendation: "keep-ours", reason: "Kilo owns the full content" }
  if (isKiloOwned(file)) return { recommendation: "keep-ours", reason: "Kilo-owned path" }
  if (file.startsWith(".github/workflows/") && ours === undefined)
    return { recommendation: "workflow", reason: "Kilo deleted this workflow: `script/check-workflows.ts --fix`" }
  if (isLockFile(file, config.lockFiles)) return { recommendation: "lock-file", reason: "Accept ours, then regenerate" }
  if (ours?.includes("kilocode_change"))
    return { recommendation: "manual", reason: "Kilo side has kilocode_change markers: keep the Kilo change, take upstream's other changes" }

  const type = classifyFile(file)
  if (type === "package") return { recommendation: "package-transform", reason: "Merge package.json fields" }
  if (config.transforms.branding) {
    if (type === "i18n") return { recommendation: "i18n-transform", reason: "Take upstream and apply Kilo branding" }
    if (matches(file, config.takeTheirsAndTransform))
      return { recommendation: "take-theirs-transform", reason: "Take upstream and apply Kilo branding" }
    if (type === "script") return { recommendation: "script-transform", reason: "Take upstream and apply Kilo branding" }
    if (type === "extension") return { recommendation: "extension-transform", reason: "Take upstream and apply Kilo branding" }
    if (type === "web") return { recommendation: "web-transform", reason: "Take upstream and apply Kilo branding" }
  }
  return { recommendation: "manual", reason: "Resolve by hand" }
}

/** Analyze a merge of `target` into `base` without changing the working tree */
export async function analyzeSync(
  base: string,
  target: string,
  pin: string,
  config: MergeConfig = defaultConfig,
): Promise<Analysis> {
  const mergeBase = (await $`git merge-base ${base} ${target}`.quiet().text()).trim()
  // quotePath off, so non-ASCII paths come out as they are and match the classifiers.
  const tree = await $`git -c core.quotePath=false merge-tree --write-tree --name-only --messages ${base} ${target}`
    .quiet()
    .nothrow()
  if (tree.exitCode > 1) throw new Error(`git merge-tree failed: ${tree.stderr.toString()}`)
  const [head = "", ...messages] = tree.stdout.toString().split("\n\n")
  const names = head.split("\n").slice(1).filter(Boolean)
  const info = messages.join("\n").split("\n")

  // Exit 1 without a conflicted file is still a conflict (for example a directory rename).
  const treeLevel: ConflictFile[] =
    tree.exitCode === 1 && names.length === 0
      ? [
          {
            path: "(no single file)",
            kind: info.find((line) => line.startsWith("CONFLICT"))?.match(/^CONFLICT \(([^)]+)\)/)?.[1] ?? "tree",
            type: "other",
            recommendation: "manual",
            reason: "git merge-tree reports a conflict without a file: read its messages",
          },
        ]
      : []
  const files = await Promise.all(
    names.map(async (file) => {
      const kind = info.find((line) => line.startsWith("CONFLICT") && line.includes(file))?.match(/^CONFLICT \(([^)]+)\)/)?.[1]
      const ours = await show(base, file)
      return { path: file, kind: kind ?? "unknown", type: classifyFile(file), ...getRecommendation(file, config, ours) }
    }),
  )
  const conflicts = [...treeLevel, ...files]

  const changed = await list($`git diff --name-only ${mergeBase} ${target}`)
  const newWorkflows = await list(
    $`git diff --name-only --diff-filter=A ${mergeBase} ${target} -- .github/workflows/`,
  ).then(async (files) => (await Promise.all(files.map(async (f) => ((await show(base, f)) === undefined ? f : "")))).filter(Boolean))
  const upstream = new Set(await list($`git ls-tree -r --name-only ${pin}`))
  const kilo = (await list($`git diff --name-only ${pin} ${base}`)).filter((file) => !isKiloOwned(file, upstream))
  const touched = new Set(changed)
  const stat = (await $`git diff --shortstat ${mergeBase} ${target} -- ${config.harness}`.quiet().text()).trim()

  return {
    base,
    target,
    mergeBase,
    commits: Number((await $`git rev-list --count ${base}..${target}`.quiet().text()).trim()),
    changed: changed.length,
    harness: {
      files: Number(stat.match(/(\d+) files? changed/)?.[1] ?? 0),
      insertions: Number(stat.match(/(\d+) insertions?/)?.[1] ?? 0),
      deletions: Number(stat.match(/(\d+) deletions?/)?.[1] ?? 0),
    },
    conflicts,
    newWorkflows,
    sharedTouched: kilo.filter((file) => touched.has(file)).sort(),
  }
}

async function show(ref: string, file: string) {
  const result = await $`git show ${`${ref}:${file}`}`.quiet().nothrow()
  return result.exitCode === 0 ? result.stdout.toString() : undefined
}

async function list(command: ReturnType<typeof $>) {
  return (await command.quiet().text()).split("\n").filter(Boolean)
}

export function generateMarkdownReport(report: SyncReport): string {
  const a = report.analysis
  const lag = (l: Lag) => `${l.releases} release(s), ${l.days} day(s)`
  return [
    `# Upstream sync report: ${report.release.tag}`,
    "",
    `Generated: ${report.timestamp}`,
    "",
    "| Item | Value |",
    "|---|---|",
    `| Release | ${report.release.tag} (tag \`${report.release.tagCommit.slice(0, 11)}\`, ${report.release.date}) |`,
    `| Release commit (merged) | \`${report.release.commit}\` |`,
    `| Base | ${report.baseBranch} \`${report.baseCommit.slice(0, 11)}\` |`,
    `| Merge branch | ${report.mergeBranch || "(none, analysis only)"} |`,
    `| Merge base | \`${a.mergeBase.slice(0, 11)}\` |`,
    `| Commits added to history | ${a.commits} |`,
    `| Files changed upstream | ${a.changed} |`,
    `| Harness change | ${a.harness.files} files, +${a.harness.insertions} / -${a.harness.deletions} |`,
    `| Lag before | ${lag(report.lagBefore)} |`,
    `| Lag after | ${lag(report.lagAfter)} |`,
    "",
    "## Conflicts",
    "",
    ...(a.conflicts.length === 0
      ? ["None."]
      : [
          "| File | Kind | Recommendation | Reason |",
          "|---|---|---|---|",
          ...a.conflicts.map((c) => `| \`${c.path}\` | ${c.kind} | ${c.recommendation} | ${c.reason} |`),
        ]),
    "",
    "## New upstream workflows",
    "",
    ...(a.newWorkflows.length === 0
      ? ["None."]
      : [
          ...a.newWorkflows.map((f) => `- \`${f}\``),
          "",
          "Review each one, then add it to `active` or `removed` in `script/check-workflows.ts`.",
        ]),
    "",
    "## Shared files touched",
    "",
    "Shared upstream files that Kilo patched and upstream changed in this sync:",
    "",
    ...(a.sharedTouched.length === 0 ? ["None."] : a.sharedTouched.map((f) => `- \`${f}\``)),
    "",
    ...(report.notes.length === 0 ? [] : ["## Notes", "", ...report.notes.map((n) => `- ${n}`), ""]),
  ].join("\n")
}

export async function saveReport(report: SyncReport, file: string): Promise<void> {
  await Bun.write(file, generateMarkdownReport(report))
}

/** Reports go to the git directory, so a merge never commits them by accident */
export async function reportPath(tag: string, output?: string) {
  if (output) return output
  const dir = (await $`git rev-parse --absolute-git-dir`.quiet().text()).trim()
  return path.join(dir, "upstream-sync", `report-${tag}.md`)
}
