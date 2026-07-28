// kilocode_change - new file

/**
 * Prepares the rolling docs-sync branch before the edit pass:
 *   - an open auto-docs PR exists -> check out its head branch and merge
 *     origin/main (preserves any human commits on the branch)
 *   - otherwise -> fresh branch from origin/main (bot force-pushes later)
 *
 * Outputs: branch, mode (update|fresh|conflict), pr_number (empty when fresh).
 */

import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { api, appendOutput, repo, searchIssues } from "./lib.mjs"

export const DEFAULT_BRANCH = "docs/auto-sync"

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

async function main() {
  const git = defaultGit
  const prs = await searchIssues(`repo:${repo()} is:pr is:open label:auto-docs sort:created-desc`, { maxPages: 1 })

  let mode = "fresh"
  let prNumber = ""
  let branch = DEFAULT_BRANCH

  if (prs.length > 0) {
    const pr = await api(`/repos/${repo()}/pulls/${prs[0].number}`)
    branch = pr.head?.ref ?? DEFAULT_BRANCH
    prNumber = String(pr.number)
    git(["fetch", "origin", "main", branch])
    git(["checkout", branch])
    ;({ branch, mode } = mergeOrFallback({ branch, git }))
  } else {
    // Keep the remote-tracking ref current so the later --force-with-lease
    // push (stale branch left over from a merged/closed PR) is safe.
    try {
      git(["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
    } catch {
      console.log(`branch ${branch} does not exist on origin yet; will create it on push`)
    }
    git(["checkout", "-B", branch, "origin/main"])
  }

  appendOutput("branch", branch)
  appendOutput("mode", mode)
  appendOutput("pr_number", prNumber)
  console.log(`branch ${branch} ready (mode=${mode}, pr=${prNumber || "none"})`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
