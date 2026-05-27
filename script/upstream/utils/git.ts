#!/usr/bin/env bun
/**
 * Git utilities for upstream merge automation
 */

import { $ } from "bun"
import { rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface BranchInfo {
  current: string
  exists: boolean
}

export interface RemoteInfo {
  name: string
  url: string
}

export interface CompatBase {
  commit: string
  upstream: string
  message: string
}

type Semver = readonly [number, number, number]

interface Candidate extends CompatBase {
  version: Semver
}

export async function getCurrentBranch(): Promise<string> {
  const result = await $`git rev-parse --abbrev-ref HEAD`.text()
  return result.trim()
}

export async function branchExists(name: string): Promise<boolean> {
  const result = await $`git show-ref --verify --quiet refs/heads/${name}`.nothrow()
  return result.exitCode === 0
}

export async function remoteBranchExists(remote: string, branch: string): Promise<boolean> {
  const result = await $`git ls-remote --heads ${remote} ${branch}`.text()
  return result.trim().length > 0
}

export async function getRemotes(): Promise<RemoteInfo[]> {
  const result = await $`git remote -v`.text()
  const lines = result.trim().split("\n")
  const remotes: RemoteInfo[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const parts = line.split(/\s+/)
    const name = parts[0] ?? ""
    const url = parts[1] ?? ""
    if (name && !seen.has(name)) {
      seen.add(name)
      remotes.push({ name, url })
    }
  }

  return remotes
}

export async function hasUpstreamRemote(): Promise<boolean> {
  const remotes = await getRemotes()
  return remotes.some((r) => r.name === "upstream")
}

export async function fetchUpstream(): Promise<void> {
  const result = await $`git fetch upstream --tags --force`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to fetch upstream: ${result.stderr.toString()}`)
  }
}

export async function checkout(ref: string): Promise<void> {
  await $`git checkout ${ref}`
}

export async function createBranch(name: string, from?: string): Promise<void> {
  if (from) {
    await $`git checkout -b ${name} ${from}`
  } else {
    await $`git checkout -b ${name}`
  }
}

export async function deleteBranch(name: string, force = false): Promise<void> {
  if (force) {
    await $`git branch -D ${name}`
  } else {
    await $`git branch -d ${name}`
  }
}

export async function backupAndDeleteBranch(name: string): Promise<string | null> {
  if (!(await branchExists(name))) return null

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const backupName = `backup/${name}-${timestamp}`
  const current = await getCurrentBranch()

  // Create backup from the existing branch
  await $`git branch ${backupName} ${name}`

  // Delete the old branch (must not be on it)
  if (current === name) {
    throw new Error(`Cannot backup and delete branch '${name}' while it is checked out`)
  }
  await deleteBranch(name, true)

  return backupName
}

export async function push(remote = "origin", branch?: string, setUpstream = false): Promise<void> {
  const currentBranch = branch || (await getCurrentBranch())
  if (setUpstream) {
    await $`git push -u ${remote} ${currentBranch}`
  } else {
    await $`git push ${remote} ${currentBranch}`
  }
}

export async function pull(remote = "origin", branch?: string): Promise<void> {
  if (branch) {
    await $`git pull ${remote} ${branch}`
  } else {
    await $`git pull ${remote}`
  }
}

export async function commit(message: string): Promise<void> {
  await $`git commit -am ${message}`
}

export async function merge(branch: string): Promise<{ success: boolean; conflicts: string[] }> {
  // Force zdiff3 markers even if the contributor's local config has drifted:
  // conflicts carry the base version (|||||||) alongside ours/theirs so mergiraf
  // has the common ancestor for structural heuristics and any remaining manual
  // resolution is dramatically easier. `postinstall` (script/setup-git.ts) sets
  // this repo-wide as well; the `-c` override here is belt-and-suspenders.
  const result = await $`git -c merge.conflictStyle=zdiff3 merge ${branch}`.nothrow()

  if (result.exitCode === 0) {
    return { success: true, conflicts: [] }
  }

  // Get list of conflicted files
  const conflicts = await getConflictedFiles()
  return { success: false, conflicts }
}

export async function getConflictedFiles(): Promise<string[]> {
  const result = await $`git diff --name-only --diff-filter=U`.text()
  return result
    .trim()
    .split("\n")
    .filter((f) => f.length > 0)
}

export async function hasUncommittedChanges(): Promise<boolean> {
  const result = await $`git status --porcelain`.text()
  return result.trim().length > 0
}

export async function restoreDirectories(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await $`git restore ${dir}`.quiet().nothrow()
  }
}

export async function stageAll(): Promise<void> {
  await $`git add -A`
}

export async function stageFiles(files: string[]): Promise<void> {
  for (const file of files) {
    await $`git add ${file}`
  }
}

export async function getCommitMessage(ref: string): Promise<string> {
  const result = await $`git log -1 --format=%s ${ref}`.text()
  return result.trim()
}

export async function getCommitHash(ref: string): Promise<string> {
  const result = await $`git rev-parse ${ref}`.text()
  return result.trim()
}

export async function getCommitParents(ref: string): Promise<string[]> {
  const result = await $`git show --no-patch --format=%P ${ref}`.text()
  return result
    .trim()
    .split(/\s+/)
    .filter((parent) => parent.length > 0)
}

export async function writeTree(): Promise<string> {
  const result = await $`git write-tree`.text()
  return result.trim()
}

export async function createCommit(tree: string, message: string, parent: string): Promise<string> {
  const result = await $`git commit-tree ${tree} -p ${parent} -m ${message}`.text()
  return result.trim()
}

export async function updateBranch(name: string, commit: string): Promise<void> {
  await $`git update-ref refs/heads/${name} ${commit}`
}

export async function recordAncestor(ref: string, message: string): Promise<boolean> {
  if (await isAncestor(ref, "HEAD")) return false

  const result = await $`git merge -s ours --no-ff ${ref} -m ${message}`.nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to record ancestor ${ref}: ${result.stderr.toString()}`)
  }
  return true
}

async function compatUpstream(message: string): Promise<string | null> {
  const tag = compatTag(message)
  if (!tag) return null

  const ref = `${tag}^{commit}`
  const result = await $`git rev-parse ${ref}`.quiet().nothrow()
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}

function compatTag(message: string): string | null {
  const prefix = "refactor: kilo compat for "
  if (!message.startsWith(prefix)) return null
  return message.slice(prefix.length).trim().split(/\s+/)[0] ?? null
}

function parseSemver(value: string | undefined): Semver | null {
  const match = value?.match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null
  const major = Number.parseInt(match[1] ?? "0", 10)
  const minor = Number.parseInt(match[2] ?? "0", 10)
  const patch = Number.parseInt(match[3] ?? "0", 10)
  return [major, minor, patch]
}

function compareSemver(a: Semver, b: Semver): number {
  for (const idx of [0, 1, 2] as const) {
    if (a[idx] < b[idx]) return -1
    if (a[idx] > b[idx]) return 1
  }
  return 0
}

function exists<T>(value: T | null): value is T {
  return value !== null
}

async function targetSemver(ref: string): Promise<Semver | null> {
  const tags = await getTagsForCommit(ref)
  const tag = tags.find((item) => parseSemver(item) !== null)
  const parsed = parseSemver(tag)
  if (parsed) return parsed

  const message = await getCommitMessage(ref)
  const match = message.match(/\bv?\d+\.\d+\.\d+\b/)
  return parseSemver(match?.[0])
}

async function candidate(line: string): Promise<Candidate | null> {
  const [commit, message = ""] = line.split("\0")
  if (!commit) return null

  const version = parseSemver(compatTag(message) ?? undefined)
  if (!version) return null

  const upstream = (await compatUpstream(message)) ?? (await getCommitParents(commit))[0] ?? commit
  return { commit, upstream, message, version }
}

export async function findLatestCompatCommit(base: string, target: string): Promise<CompatBase | null> {
  const grep = "^refactor: kilo compat for "
  const result = await $`git log --format=%H%x00%s --grep=${grep} ${base}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to search compatibility commits: ${result.stderr.toString()}`)
  }

  const lines = result.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)

  const targetVersion = await targetSemver(target)
  if (targetVersion) {
    const candidates = (await Promise.all(lines.map(candidate)))
      .filter(exists)
      .filter((item) => compareSemver(item.version, targetVersion) < 0)
      .sort((a, b) => compareSemver(b.version, a.version))
    const latest = candidates[0]
    if (latest) return { commit: latest.commit, upstream: latest.upstream, message: latest.message }
  }

  for (const line of lines) {
    const [commit, message = ""] = line.split("\0")
    if (!commit) continue

    const upstream = await compatUpstream(message)
    if (upstream && (await isAncestor(upstream, target))) return { commit, upstream, message }

    const parents = await getCommitParents(commit)
    for (const parent of parents) {
      if (await isAncestor(parent, target)) return { commit, upstream: parent, message }
    }
  }

  return null
}

/**
 * Check if `commit` is an ancestor of `ref` (i.e. reachable from `ref`).
 * Uses `git merge-base --is-ancestor`, which exits 0 for yes, 1 for no.
 * Any other exit code (e.g. unknown commit) is treated as "not an ancestor".
 */
export async function isAncestor(commit: string, ref = "HEAD"): Promise<boolean> {
  const result = await $`git merge-base --is-ancestor ${commit} ${ref}`.quiet().nothrow()
  return result.exitCode === 0
}

export async function getTagsForCommit(commit: string): Promise<string[]> {
  const result = await $`git tag --points-at ${commit}`.text()
  return result
    .trim()
    .split("\n")
    .filter((t) => t.length > 0)
}

export async function getAllTags(): Promise<string[]> {
  const result = await $`git tag -l`.text()
  return result
    .trim()
    .split("\n")
    .filter((t) => t.length > 0)
}

export async function getUpstreamTags(): Promise<string[]> {
  const result = await $`git ls-remote --tags upstream`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list upstream tags: ${result.stderr.toString()}`)
  }

  const output = result.stdout.toString()
  const tags: string[] = []

  for (const line of output.trim().split("\n")) {
    const match = line.match(/refs\/tags\/([^\^]+)$/)
    if (match && match[1]) tags.push(match[1])
  }

  return tags
}

export async function abortMerge(): Promise<void> {
  await $`git merge --abort`
}

export async function checkoutOurs(files: string[]): Promise<void> {
  for (const file of files) {
    await $`git checkout --ours ${file}`
  }
}

export async function checkoutTheirs(files: string[]): Promise<void> {
  for (const file of files) {
    await $`git checkout --theirs ${file}`
  }
}

/**
 * Remove untracked files and directories from specific directories.
 * Used to clean build artifacts from Kilo-specific directories after checking
 * out the upstream branch, where package-level .gitignore files don't exist.
 */
export async function cleanDirectories(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await $`git clean -fd ${dir}`.quiet().nothrow()
  }
}

/**
 * Check if the "ours" version of a conflicted file contains kilocode_change markers.
 * Uses git stage :2: which is the "ours" side during a merge conflict.
 * Returns false if the file doesn't exist in ours (new file from upstream).
 */
export async function oursHasKilocodeChanges(file: string): Promise<boolean> {
  const result = await $`git show :2:${file}`.quiet().nothrow()
  if (result.exitCode !== 0) return false
  return result.stdout.toString().includes("kilocode_change")
}

/**
 * Enable git rerere (REuse REcorded REsolution) in the local repo config.
 * Also enables autoupdate so resolved files are automatically staged.
 */
export async function ensureRerere(): Promise<void> {
  await $`git config rerere.enabled true`.quiet()
  await $`git config rerere.autoupdate true`.quiet()
}

async function reset(dir: string): Promise<void> {
  await $`git -C ${dir} reset -q --hard`.quiet().nothrow()
  await $`git -C ${dir} clean -fdx`.quiet().nothrow()
}

/**
 * Train the rerere cache from past merge commits in the repo history.
 * Implements the same logic as git's contrib/rerere-train.sh:
 *   For each merge commit in the range, replay the merge to let rerere
 *   record the pre-image, then check out the resolved tree so rerere
 *   records the post-image (the resolution).
 *
 * Returns the number of resolutions learned.
 */
export async function trainRerere(grep: string): Promise<number> {
  const head = (await $`git rev-parse --verify HEAD`.text()).trim()
  const dir = join(tmpdir(), `kilo-rerere-train-${randomUUID()}`)

  let learned = 0

  try {
    await $`git worktree add --detach ${dir} ${head}`.quiet()

    // Find all merge commits matching the grep pattern (merges have multiple parents)
    const revList = await $`git rev-list --parents --all --grep=${grep}`.quiet().nothrow()
    if (revList.exitCode !== 0 || !revList.stdout.toString().trim()) return 0

    const lines = revList.stdout
      .toString()
      .trim()
      .split("\n")
      .filter((l) => l.trim())

    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 3) continue // skip non-merges (need commit + at least 2 parents)

      const [commit, parent1, ...otherParents] = parts

      await reset(dir)

      // Checkout the first parent
      const coResult = await $`git -C ${dir} checkout -q ${parent1}`.quiet().nothrow()
      if (coResult.exitCode !== 0) continue

      // Attempt the merge - we expect it to fail with conflicts
      const mergeResult = await $`git -C ${dir} merge --no-gpg-sign ${otherParents}`.quiet().nothrow()
      if (mergeResult.exitCode === 0) {
        // Cleanly merged — no conflicts to learn from, reset and skip
        await reset(dir)
        continue
      }

      // Check if rerere recorded a pre-image (MERGE_RR exists and is non-empty)
      const rr = await $`git -C ${dir} rev-parse --git-path MERGE_RR`.text()
      const hasMergeRR = await Bun.file(rr.trim())
        .exists()
        .catch(() => false)
      if (!hasMergeRR) {
        await reset(dir)
        continue
      }

      // Record the conflict pre-image
      await $`git -C ${dir} rerere`.quiet().nothrow()

      // Apply the actual resolution by checking out the merge commit's tree
      await $`git -C ${dir} checkout -q ${commit} -- .`.quiet().nothrow()

      // Record the resolution post-image
      await $`git -C ${dir} rerere`.quiet().nothrow()

      learned++
      await reset(dir)
    }
  } finally {
    await $`git worktree remove --force ${dir}`.quiet().nothrow()
    await rm(dir, { recursive: true, force: true })
  }

  return learned
}

/**
 * Return files that git rerere has already auto-resolved.
 * These files no longer have conflict markers but haven't been staged yet
 * (unless rerere.autoupdate is true, in which case they're already staged).
 */
export async function getRerereResolved(): Promise<string[]> {
  const result = await $`git rerere status`.quiet().nothrow()
  if (result.exitCode !== 0 || !result.stdout.toString().trim()) return []
  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f) => f.length > 0)
}
