// kilocode_change - new file

/**
 * Prepares the rolling docs-sync integration branch before the edit pass.
 *
 * The integration branch is always `DEFAULT_BRANCH` (`docs/auto-sync`) and
 * carries the accumulating tree; it has no PR of its own. This step:
 *   - checks it out (fetching it when it exists on origin, else creating it
 *     from origin/main) and merges origin/main via mergeOrFallback
 *   - merges each open per-surface `docs/auto-sync/<surface>` PR branch
 *     (best effort; a per-branch conflict is aborted and skipped)
 *
 * Legacy rolling PRs are ignored completely: a dated branch like
 * `docs/auto-sync-2026-09-11` is neither a surface branch nor an integration
 * base, so this step never comments on, closes, or reuses one.
 *
 * Outputs: branch, mode (update|fresh|conflict).
 */

import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { api, appendOutput, repo, searchIssues } from "./lib.mjs"
import { isSurfaceBranch, surfaceNameFromBranch } from "./surfaces.mjs"

export const DEFAULT_BRANCH = "docs/auto-sync"
// Git refs cannot hold both `docs/auto-sync` and `docs/auto-sync/<surface>`, so
// the integration tree is pushed to this sibling durability ref instead.
export const INTEGRATION_BRANCH = "docs/auto-sync-integration"

const defaultGit = (args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim()

/**
 * Merge origin/main into the current branch. On a genuine conflict, abort the
 * merge, switch to a dated fallback branch from origin/main, and return
 * mode=conflict so human commits on the rolling branch stay untouched. Any
 * other merge failure (missing identity, corrupt ref, fetch issues) is
 * rethrown so the job fails loudly.
 */
export function mergeOrFallback({ branch, git = defaultGit }) {
  try {
    git(["merge", "origin/main", "--no-edit"])
    return { branch, mode: "update" }
  } catch (err) {
    // Conflict ⇔ unmerged index entries (or MERGE_HEAD still present).
    // Identity failures and similar abort before a merge is started, so
    // merge --abort would itself fail — those must rethrow.
    let unmerged = ""
    try {
      unmerged = git(["ls-files", "--unmerged"])
    } catch {
      // ls-files itself failing is not a conflict signal
    }
    let mergeInProgress = false
    try {
      git(["rev-parse", "-q", "--verify", "MERGE_HEAD"])
      mergeInProgress = true
    } catch {
      mergeInProgress = false
    }
    const isConflict = unmerged.length > 0 || mergeInProgress
    if (!isConflict) throw err

    console.warn(`merge of origin/main into ${branch} conflicted.`)
    console.warn(
      "Leaving the conflicted branch untouched so human commits are preserved; continuing on a fresh dated branch.",
    )
    git(["merge", "--abort"])
    const fallback = `${DEFAULT_BRANCH}-${new Date().toISOString().slice(0, 10)}`
    try {
      git(["fetch", "origin", `+refs/heads/${fallback}:refs/remotes/origin/${fallback}`])
    } catch {
      console.log(`dated branch ${fallback} does not exist on origin yet; will create it on push`)
    }
    git(["checkout", "-B", fallback, "origin/main"])
    return { branch: fallback, mode: "conflict" }
  }
}

/**
 * Best-effort merge of one surface branch into the integration branch. The
 * fetched ref lands under `refs/docs-sync/surfaces/` so it cannot collide with
 * the integration branch's own remote-tracking ref (`docs/auto-sync` may not be
 * a path prefix of `docs/auto-sync/<surface>`).
 */
function mergeSurface(git, ref, name) {
  const local = `refs/docs-sync/surfaces/${name}`
  try {
    git(["fetch", "origin", `+refs/heads/${ref}:${local}`])
    git(["merge", local, "--no-edit"])
    return true
  } catch (err) {
    let unmerged = ""
    try {
      unmerged = git(["ls-files", "--unmerged"])
    } catch {
      // ls-files failing is not a conflict signal
    }
    let inProgress = false
    try {
      git(["rev-parse", "-q", "--verify", "MERGE_HEAD"])
      inProgress = true
    } catch {
      inProgress = false
    }
    if (unmerged.length > 0 || inProgress) {
      try {
        git(["merge", "--abort"])
      } catch (abortErr) {
        console.warn(`::warning::docs-sync: could not abort merge of ${ref}: ${abortErr.message}`)
      }
    }
    console.warn(`::warning::docs-sync: could not merge ${ref} into the integration branch: ${err.message}`)
    return false
  }
}

async function main() {
  const git = defaultGit
  // Page or two covers one PR per surface.
  const prs = await searchIssues(`repo:${repo()} is:pr is:open label:auto-docs sort:created-desc`, { maxPages: 2 })

  const details = []
  for (const pr of prs) {
    try {
      details.push(await api(`/repos/${repo()}/pulls/${pr.number}`))
    } catch (err) {
      console.warn(`::warning::docs-sync: could not read auto-docs PR #${pr.number}: ${err.message}`)
    }
  }

  // Only `docs/auto-sync/<surface>` heads are this job's own PRs: a legacy
  // dated branch (`docs/auto-sync-<date>`) and the bare integration ref are not.
  const surfacePrs = details.filter((pr) => isSurfaceBranch(pr?.head?.ref))

  let branch = DEFAULT_BRANCH
  let mode = "fresh"

  // Integration base order: the durability ref, then the bare `docs/auto-sync`
  // integration ref, then a fresh checkout of origin/main. A dated legacy
  // branch is never one of these.
  let base = null
  const bases = [
    { remote: INTEGRATION_BRANCH, local: INTEGRATION_BRANCH },
    { remote: DEFAULT_BRANCH, local: `${DEFAULT_BRANCH}-legacy` },
  ]
  for (const candidate of bases) {
    if (base) break
    try {
      git(["fetch", "origin", `+refs/heads/${candidate.remote}:refs/remotes/origin/${candidate.local}`])
      base = `origin/${candidate.local}`
    } catch {
      console.log(`branch ${candidate.remote} does not exist on origin yet`)
    }
  }

  if (base) {
    git(["checkout", "-B", DEFAULT_BRANCH, base])
    ;({ branch, mode } = mergeOrFallback({ branch: DEFAULT_BRANCH, git }))
  } else {
    git(["checkout", "-B", DEFAULT_BRANCH, "origin/main"])
  }

  // Human commits on a surface PR must stay in the integration tree. A single
  // per-branch conflict warns and continues — it must never fail the run.
  for (const pr of surfacePrs) {
    const ref = String(pr.head?.ref ?? "")
    const name = surfaceNameFromBranch(ref) ?? "unknown"
    if (mergeSurface(git, ref, name)) console.log(`merged ${ref} into ${branch}`)
  }

  // A ref may not be a path prefix of another ref, so `docs/auto-sync` must be
  // gone for `docs/auto-sync/<surface>` to exist. Its content already lives in
  // the integration base and the per-surface branches. Delete it whether or not
  // an open legacy PR was found: a lingering branch (a closed PR, a partial
  // cleanup) still blocks every surface push.
  try {
    const stale = git(["ls-remote", "--heads", "origin", DEFAULT_BRANCH])
      .split("\n")
      .some((line) => line.endsWith(`refs/heads/${DEFAULT_BRANCH}`))
    if (stale) {
      try {
        git(["push", "origin", "--delete", DEFAULT_BRANCH])
      } catch (err) {
        console.warn(`::warning::docs-sync: could not delete the legacy branch ${DEFAULT_BRANCH}: ${err.message}`)
      }
    }
  } catch (err) {
    console.warn(`::warning::docs-sync: could not check for the legacy branch ${DEFAULT_BRANCH}: ${err.message}`)
  }
  // Drop the stale remote-tracking ref too, otherwise fetching or pushing a
  // `docs/auto-sync/<surface>` branch later in the run fails on the
  // directory/file ref conflict. Deleting a ref that is not present is a no-op.
  try {
    git(["update-ref", "-d", `refs/remotes/origin/${DEFAULT_BRANCH}`])
  } catch (err) {
    console.warn(`::warning::docs-sync: could not remove the stale ref for ${DEFAULT_BRANCH}: ${err.message}`)
  }

  appendOutput("branch", branch)
  appendOutput("mode", mode)
  console.log(`branch ${branch} ready (mode=${mode}, surfacePrs=${surfacePrs.length})`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
