// kilocode_change - new file

/**
 * Prepares the rolling docs-sync branch before the edit pass:
 *   - an open auto-docs PR exists -> check out its branch and merge
 *     origin/main (preserves any human commits on the branch)
 *   - otherwise -> fresh branch from origin/main (bot force-pushes later)
 *
 * Outputs: branch, mode (update|fresh), pr_number (empty when fresh).
 */

import { execFileSync } from "node:child_process"
import { appendOutput, repo, searchIssues } from "./lib.mjs"

export const BRANCH = "docs/auto-sync"

const git = (args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim()

const prs = await searchIssues(`repo:${repo()} is:pr is:open label:auto-docs sort:created-desc`, { maxPages: 1 })

let mode = "fresh"
let prNumber = ""

if (prs.length > 0) {
  const pr = prs[0]
  prNumber = String(pr.number)
  git(["fetch", "origin", "main", BRANCH])
  git(["checkout", BRANCH])
  try {
    git(["merge", "origin/main", "--no-edit"])
    mode = "update"
  } catch {
    console.warn(`merge of origin/main into ${BRANCH} conflicted; resetting branch to origin/main.`)
    console.warn("Unmerged work on the previous branch is re-derived from the watermark window.")
    git(["merge", "--abort"])
    git(["checkout", "-B", BRANCH, "origin/main"])
    mode = "fresh"
  }
} else {
  // Keep the remote-tracking ref current so the later --force-with-lease
  // push (stale branch left over from a merged/closed PR) is safe.
  try {
    git(["fetch", "origin", `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`])
  } catch {
    // branch does not exist on origin yet — fine
  }
  git(["checkout", "-B", BRANCH, "origin/main"])
}

appendOutput("branch", BRANCH)
appendOutput("mode", mode)
appendOutput("pr_number", prNumber)
console.log(`branch ${BRANCH} ready (mode=${mode}, pr=${prNumber || "none"})`)
