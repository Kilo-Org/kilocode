#!/usr/bin/env bun
/**
 * Upstream sync for the Kilo v2 line.
 *
 * Merges one upstream release commit (the parent of a `v2.x.y` tag on `upstream/dev`) into a new
 * branch from `origin/v2`, resolves the known conflict types, and writes a sync report.
 *
 * Usage:
 *   bun script/upstream/merge.ts [options]
 *
 * Options:
 *   --version <tag>       Release to sync, for example v2.0.27 (default: the next release `v2` does not have)
 *   --commit <sha>        Pin a commit on upstream/dev instead of a release (only for an unreleased fix Kilo needs)
 *   --base-branch <name>  Base branch (default: v2, read from origin/v2). HEAD merges into the current branch in place
 *   --branch <name>       Name of the sync branch (default: sync-v2-0-27)
 *   --dry-run             Analyze and write the report only
 *   --report-only         Same as --dry-run
 *   --allow-skip          Allow a target that skips older releases
 *   --no-fetch            Do not fetch origin and upstream
 *   --no-worktrees        Do not create read-only reference worktrees
 *   --no-install          Do not regenerate lock files
 *   --push                Push the sync branch to origin after the merge commit
 *   --output <path>       Report path (default: .git/upstream-sync/report-<tag>.md)
 *   --verbose             Verbose logging
 */

import { $ } from "bun"
import * as git from "./utils/git"
import * as logger from "./utils/logger"
import * as report from "./utils/report"
import * as worktree from "./utils/worktree"
import { loadConfig, resolveBaseBranch, type MergeConfig } from "./utils/config"
import { compareVersions, findRelease, getSyncStatus, upstreamRef, type Release } from "./utils/version"
import { pinned, syncMessage } from "./utils/upstream"
import { keepOursFiles } from "./transforms/keep-ours"
import { skipFiles } from "./transforms/skip-files"
import { transformConflictedI18n } from "./transforms/transform-i18n"
import { transformConflictedTakeTheirs } from "./transforms/transform-take-theirs"
import { transformConflictedPackageJson, assertBunPackageManager } from "./transforms/transform-package-json"
import { transformConflictedScripts } from "./transforms/transform-scripts"
import { transformConflictedExtensions } from "./transforms/transform-extensions"
import { transformConflictedWeb } from "./transforms/transform-web"
import { resolveLockFileConflicts, regenerateLockFiles } from "./transforms/lock-files"
import { BASELINE } from "./utils/baseline"

export interface MergeOptions {
  version?: string
  commit?: string
  baseBranch?: string
  branch?: string
  dryRun: boolean
  allowSkip: boolean
  fetch: boolean
  worktrees: boolean
  install: boolean
  push: boolean
  output?: string
  verbose: boolean
}

export function parseArgs(args: string[]): MergeOptions {
  const value = (name: string) => {
    const i = args.indexOf(name)
    if (i === -1) return undefined
    const next = args[i + 1]
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
    return next
  }
  return {
    version: value("--version"),
    commit: value("--commit"),
    baseBranch: value("--base-branch"),
    branch: value("--branch"),
    output: value("--output"),
    dryRun: args.includes("--dry-run") || args.includes("--report-only"),
    allowSkip: args.includes("--allow-skip"),
    fetch: !args.includes("--no-fetch"),
    worktrees: !args.includes("--no-worktrees"),
    install: !args.includes("--no-install"),
    push: args.includes("--push"),
    verbose: args.includes("--verbose"),
  }
}

/** Sync branch name: `sync-v2-0-27` */
export function branchName(release: Pick<Release, "tag">, config: MergeConfig) {
  return `${config.branchPrefix}-${release.tag.replaceAll(".", "-")}`
}

export async function main(argv: string[]) {
  // Transforms read repo-relative paths, so run from the repository root.
  process.chdir((await $`git rev-parse --show-toplevel`.text()).trim())
  const options = parseArgs(argv)
  logger.setVerbose(options.verbose)
  logger.header("Kilo v2 Upstream Sync")

  logger.step(1, 7, "Validating environment...")
  const current = await git.getCurrentBranch()
  const base = resolveBaseBranch(options.baseBranch, current)
  const config = loadConfig(base ? { baseBranch: base } : undefined)
  const inplace = options.baseBranch === "HEAD"
  await validate(config, options)

  logger.step(2, 7, "Fetching...")
  if (options.fetch) {
    await git.fetchUpstream(config.upstreamRemote, config.upstreamBranch)
    if (!inplace) await git.fetchOrigin(config.originRemote, config.baseBranch)
  }
  const baseRef = inplace ? "HEAD" : await remoteOrLocal(config)
  const baseSha = await git.getCommitHash(baseRef)
  logger.info(`Base: ${inplace ? `${current} (in place)` : baseRef} ${baseSha.slice(0, 11)}`)

  logger.step(3, 7, "Determining target release...")
  const status = await getSyncStatus(baseSha, config)
  const target = await resolveTarget(options, config, status)
  logger.success(`Target: ${target.tag} release commit ${target.commit.slice(0, 11)} (${target.date})`)

  logger.step(4, 7, "Analyzing the merge...")
  const pin = await pinned(baseSha, config)
  const analysis = await report.analyzeSync(baseSha, target.commit, pin.commit, config)
  const after = await statusAfter(target, status)
  const sync: report.SyncReport = {
    timestamp: new Date().toISOString(),
    release: target,
    baseBranch: inplace ? current : config.baseBranch,
    baseCommit: baseSha,
    mergeBranch: "",
    analysis,
    lagBefore: status.lag,
    lagAfter: after,
    notes: [],
  }
  const skipped = status.pending.filter((r) => compareVersions(r.version, target.version) < 0)
  if (skipped.length > 0) {
    sync.notes.push(`Skips ${skipped.map((r) => r.tag).join(", ")} (--allow-skip). State the reason in the PR`)
  }
  printAnalysis(sync)

  const reportFile = await report.reportPath(target.tag, options.output)
  if (options.dryRun) {
    await report.saveReport(sync, reportFile)
    logger.success(`Report saved to ${reportFile}`)
    return
  }

  logger.step(5, 7, "Creating the sync branch...")
  const branch = inplace ? current : (options.branch ?? branchName(target, config))
  if (!inplace) {
    if (await git.branchExists(branch)) throw new Error(`Branch ${branch} exists. Delete it or pass --branch`)
    await $`git switch --no-track -c ${branch} ${baseSha}`.quiet()
  }
  sync.mergeBranch = branch
  logger.info(`Sync branch: ${branch}`)

  await git.ensureRerere()
  const learned = await git.trainRerere("chore(upstream): sync v")
  if (learned > 0) logger.success(`rerere learned ${learned} resolution(s) from earlier syncs`)

  logger.step(6, 7, `Merging ${target.tag}...`)
  const message = syncMessage(target.tag, target.commit)
  const merged = await git.merge(target.commit, message)
  if (!merged.success) {
    logger.warn(`${merged.conflicts.length} conflict(s):`)
    logger.list(merged.conflicts)
    await resolve(config, options, sync)
  }

  const workflows = await checkWorkflows()
  const remaining = await git.getConflictedFiles()
  if (merged.success || remaining.length === 0) await lockFiles(options, sync)

  if (remaining.length > 0 || !workflows.ok) {
    if (!workflows.ok) {
      logger.warn("Unexpected workflows after the merge:")
      logger.list(workflows.errors)
      sync.notes.push(...workflows.errors.map((e) => `Workflow: ${e}`))
    }
    if (remaining.length > 0) {
      logger.warn(`${remaining.length} conflict(s) need manual resolution:`)
      logger.list(remaining)
      sync.notes.push(...remaining.map((file) => `Manual conflict: \`${file}\``))
    }
    await report.saveReport(sync, reportFile)
    logger.success(`Report saved to ${reportFile}`)
    await references(options, target, baseSha)
    logger.divider()
    logger.info("Next steps:")
    logger.info("  1. Resolve the conflicts. Keep Kilo's kilocode_change lines, take upstream's other changes.")
    logger.info("     For a new upstream workflow: review it, add it to `active` or `removed` in")
    logger.info("     script/check-workflows.ts, then run `bun script/check-workflows.ts --fix`.")
    logger.info("  2. git add <files> && git commit --no-edit   (keeps the message: " + message + ")")
    logger.info("  3. bun install, then the checks in script/upstream/README.md")
    logger.info("To abort: git merge --abort")
    process.exit(1)
  }

  await validateBun(baseSha, target.commit)
  await git.stageAll()
  await git.commitMerge(message)
  logger.success(`Committed: ${message}`)

  logger.step(7, 7, "Finishing...")
  await guards(sync)
  if (options.push) {
    await git.push(config.originRemote, branch, true)
    logger.success(`Pushed ${branch}`)
  }
  await report.saveReport(sync, reportFile)
  logger.success(`Report saved to ${reportFile}`)
  await references(options, target, baseSha)

  logger.divider()
  logger.info("Next steps:")
  logger.info("  1. bun install, bun script/check-workflows.ts, bun run check, focused tests, self-test")
  logger.info(`  2. Open a PR from ${branch} into ${config.baseBranch}. Merge it with a merge commit, never squash.`)
}

async function validate(config: MergeConfig, options: MergeOptions) {
  if (!(await git.hasUpstreamRemote(config.upstreamRemote))) {
    logger.error(`No '${config.upstreamRemote}' remote. Add it:`)
    logger.info(`  git remote add ${config.upstreamRemote} ${config.upstreamUrl}`)
    process.exit(1)
  }
  if (!options.dryRun && (await git.hasUncommittedChanges())) {
    logger.error("The working tree has changes. Commit or stash them first.")
    process.exit(1)
  }
  const mergiraf = await $`mergiraf --version`.quiet().nothrow()
  if (mergiraf.exitCode !== 0) {
    logger.warn("mergiraf is not installed: no syntax-aware conflict resolution (brew install mergiraf)")
  }
}

async function remoteOrLocal(config: MergeConfig) {
  const remote = `${config.originRemote}/${config.baseBranch}`
  const result = await $`git rev-parse --verify --quiet ${remote}`.quiet().nothrow()
  return result.exitCode === 0 ? remote : config.baseBranch
}

async function resolveTarget(
  options: MergeOptions,
  config: MergeConfig,
  status: Awaited<ReturnType<typeof getSyncStatus>>,
): Promise<Release> {
  const branch = upstreamRef(config)
  if (options.commit) {
    const commit = await git.getCommitHash(`${options.commit}^{commit}`)
    if (!(await git.isAncestor(commit, branch))) {
      throw new Error(`${options.commit} is not on ${branch}. Never merge ${config.frozenBranches.join(", ")}`)
    }
    const release = status.releases.find((r) => r.commit === commit)
    const date = (await $`git log -1 --format=%cI ${commit}`.quiet().text()).trim()
    return release ?? { version: "unreleased", tag: `dev-${commit.slice(0, 11)}`, tagCommit: commit, commit, date }
  }

  const release = options.version ? findRelease(status.releases, options.version) : status.next
  if (!release && options.version) {
    logger.error(`Release ${options.version} not found on ${branch}. Run: bun script/upstream/list-versions.ts`)
    process.exit(1)
  }
  if (!release) {
    logger.success(`The base has the newest release (${status.merged?.tag}). Nothing to sync.`)
    process.exit(0)
  }
  if (status.merged && compareVersions(release.version, status.merged.version) <= 0) {
    logger.error(`The base already has ${release.tag} (newest merged: ${status.merged.tag})`)
    process.exit(1)
  }
  const skipped = status.pending.filter((r) => compareVersions(r.version, release.version) < 0)
  if (skipped.length > 0 && !options.allowSkip) {
    logger.error(`${release.tag} skips ${skipped.map((r) => r.tag).join(", ")}. Sync release by release, or pass --allow-skip`)
    process.exit(1)
  }
  return release
}

async function statusAfter(target: Release, status: Awaited<ReturnType<typeof getSyncStatus>>) {
  const pending = status.pending.filter((r) => compareVersions(r.version, target.version) > 0)
  const newest = status.releases[0]
  const days =
    newest && pending.length > 0 ? Math.round(((Date.parse(newest.date) - Date.parse(target.date)) / 86_400_000) * 10) / 10 : 0
  return { releases: pending.length, days }
}

function printAnalysis(sync: report.SyncReport) {
  const a = sync.analysis
  logger.info(`Commits added to history: ${a.commits}`)
  logger.info(`Files changed upstream: ${a.changed}`)
  logger.info(`Harness change: ${a.harness.files} files, +${a.harness.insertions} / -${a.harness.deletions}`)
  logger.info(`Lag before: ${sync.lagBefore.releases} release(s), ${sync.lagBefore.days} day(s)`)
  logger.info(`Lag after: ${sync.lagAfter.releases} release(s), ${sync.lagAfter.days} day(s)`)
  logger.info(`Conflicts: ${a.conflicts.length}`)
  for (const c of a.conflicts) logger.info(`  - ${c.path} (${c.kind}): ${c.recommendation}`)
  for (const note of sync.notes) logger.warn(note)
  if (a.newWorkflows.length > 0) {
    logger.warn("New upstream workflows (review, then add to `active` or `removed` in script/check-workflows.ts):")
    logger.list(a.newWorkflows)
  }
  logger.info(`Shared files touched: ${a.sharedTouched.length}`)
  logger.list(a.sharedTouched)
}

/** Resolve the known conflict types. Files that need a person stay conflicted. */
async function resolve(config: MergeConfig, options: MergeOptions, sync: report.SyncReport) {
  const transform = { dryRun: false, verbose: options.verbose }

  // Workflows that Kilo removed: `--fix` removes them, which also resolves their modify/delete conflicts.
  const fix = await $`bun script/check-workflows.ts --fix`.quiet().nothrow()
  const removed = fix.stdout.toString().split("\n").filter((line) => line.startsWith("check-workflows: removed"))
  if (removed.length > 0) logger.success(`Removed ${removed.length} workflow(s) that Kilo dropped`)

  const skipped = (await skipFiles(transform)).filter((r) => r.action === "removed")
  if (skipped.length > 0) logger.success(`Removed ${skipped.length} skipped file(s)`)

  const kept = (await keepOursFiles(transform)).filter((r) => r.action === "kept")
  if (kept.length > 0) logger.success(`Kept Kilo's version of ${kept.length} Kilo-owned file(s)`)

  const solved = await mergiraf(await git.getConflictedFiles())
  if (solved > 0) logger.success(`mergiraf resolved ${solved} file(s)`)

  const flagged: string[] = []
  const passes = [
    ...(config.transforms.branding
      ? [transformConflictedI18n, transformConflictedTakeTheirs, transformConflictedScripts, transformConflictedExtensions, transformConflictedWeb]
      : []),
    transformConflictedPackageJson,
  ]
  for (const pass of passes) {
    const files = await git.getConflictedFiles()
    if (files.length === 0) break
    const results: { file: string; action?: string; flagged?: boolean }[] = await pass(files, transform)
    flagged.push(...results.filter((r) => r.action === "flagged" || r.flagged).map((r) => r.file))
  }
  if (flagged.length > 0) {
    logger.warn("Files with kilocode_change markers, left for manual resolution:")
    logger.list(flagged)
    sync.notes.push(...flagged.map((file) => `Has kilocode_change markers: \`${file}\``))
  }

  const lock = (await resolveLockFileConflicts(transform)).filter((r) => r.action === "resolved")
  if (lock.length > 0) logger.success(`Lock file conflicts: kept ours for ${lock.length}, regenerating after the merge`)
}

/**
 * Syntax-aware resolution with mergiraf. Only files with text conflict markers are tried, and only
 * fully resolved files are staged. A modify/delete conflict has no markers and stays for review.
 */
async function mergiraf(files: string[]) {
  const results = await Promise.all(
    files.map(async (file) => {
      const before = await Bun.file(file)
        .text()
        .catch(() => "")
      if (!before.includes("<<<<<<< ")) return false
      await $`mergiraf solve --keep-backup=false ${file}`.quiet().nothrow()
      const after = await Bun.file(file)
        .text()
        .catch(() => "")
      if (!after || after.includes("<<<<<<< ")) return false
      return (await $`git add ${file}`.quiet().nothrow()).exitCode === 0
    }),
  )
  return results.filter(Boolean).length
}

async function checkWorkflows() {
  const result = await $`bun script/check-workflows.ts`.quiet().nothrow()
  const errors = result.stderr
    .toString()
    .split("\n")
    .filter((line) => /^(unexpected|removed|expected) /.test(line))
  return { ok: result.exitCode === 0, errors }
}

async function lockFiles(options: MergeOptions, sync: report.SyncReport) {
  if (!options.install) return
  const results = await regenerateLockFiles({ dryRun: false, verbose: options.verbose })
  const skipped = results.filter((r) => r.action === "skipped" || r.action === "failed")
  if (skipped.length > 0) sync.notes.push("bun.lock was not regenerated (Bun version or install error). Run `bun install` with the pinned Bun")
}

async function validateBun(base: string, upstream: string) {
  const read = async (ref?: string) => {
    const text = ref ? await $`git show ${`${ref}:package.json`}`.quiet().text() : await Bun.file("package.json").text()
    return JSON.parse(text).packageManager
  }
  assertBunPackageManager(await read(), await read(base), await read(upstream))
}

/**
 * Run the annotation check and the shared-patch counter on the result, for the report. A branch
 * without the scripts or the baseline uses the copies next to this tool.
 */
async function guards(sync: report.SyncReport) {
  const local = await Bun.file(BASELINE).exists()
  const baseline = local ? BASELINE : new URL("./shared-patches.json", import.meta.url).pathname
  if (!local) sync.notes.push(`The branch has no \`${BASELINE}\`: the guards used the copy of this tool`)
  for (const name of ["check-opencode-annotations.ts", "check-shared-patches.ts"]) {
    const branch = `script/${name}`
    const script = (await Bun.file(branch).exists()) ? branch : new URL(`../${name}`, import.meta.url).pathname
    const result = await $`bun ${script} --baseline ${baseline}`.quiet().nothrow()
    console.log(result.stdout.toString() + result.stderr.toString())
    if (result.exitCode === 0) logger.success(`${name}: ok`)
    if (result.exitCode !== 0) {
      logger.warn(`${name} failed`)
      sync.notes.push(`\`${name}\` fails after the merge. Fix it in the sync PR`)
    }
  }
}

async function references(options: MergeOptions, target: Release, base: string) {
  if (!options.worktrees) return
  const refs = await worktree.prepare({ tag: target.tag, upstream: target.commit, base, merge: target.commit })
  logger.divider()
  logger.info("Read-only reference worktrees:")
  logger.info(`  upstream:   ${refs.opencode} (${target.tag}, ${target.commit.slice(0, 11)})`)
  logger.info(`  kilo base:  ${refs.main} (${base.slice(0, 11)})`)
  logger.info(`  auto-merge: ${refs.auto} (${refs.branch})`)
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    logger.error(`Fatal error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })
}
