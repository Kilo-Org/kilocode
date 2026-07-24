// kilocode_change - new file

/**
 * Prepares the rolling docs-sync branch before the edit pass:
 *   - an open auto-docs PR exists -> check out its head branch and merge
 *     origin/main (preserves any human commits on the branch)
 *   - otherwise -> fresh branch from origin/main (bot force-pushes later)
 *
 * Outputs: branch, mode (update|fresh), pr_number (empty when fresh).
 */

import { execFileSync } from "node:child_process"
import { api, appendOutput, repo, searchIssues } from "./lib.mjs"

export const DEFAULT_BRANCH = "docs/auto-sync"

const git = (args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim()

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
  try {
    git(["merge", "origin/main", "--no-edit"])
    mode = "update"
  } catch {
    console.warn(`merge of origin/main into ${branch} conflicted.`)
    console.warn("Leaving the conflicted branch untouched so human commits are preserved; continuing on a fresh dated branch.")
    git(["merge", "--abort"])
    branch = `${DEFAULT_BRANCH}-${new Date().toISOString().slice(0, 10)}`
    try {
      git(["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
    } catch {
      console.log(`dated branch ${branch} does not exist on origin yet; will create it on push`)
    }
    git(["checkout", "-B", branch, "origin/main"])
    mode = "conflict"
  }
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
