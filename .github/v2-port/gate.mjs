// kilocode_change - new file

/**
 * Gate for the v2-port tracker: decides whether a merged PR carries a
 * Kilo-specific change to packages/opencode/ that the opencode v2 rewrite could
 * plausibly miss, and writes the agent's input files.
 *
 * A PR qualifies when its diff touches a path under packages/opencode/ that has
 * `kilocode` in a path segment or filename, or when it adds a `kilocode_change`
 * marker line in a packages/opencode/ file. That is the same signal the
 * annotations check already enforces, so upstream merges, formatting, and
 * dependency bumps are excluded without an LLM call.
 *
 * Writes v2-port-out/pr.json (full PR metadata) and v2-port-out/pr.diff
 * (truncated) for the agent step. Qualification runs on the FULL diff; only the
 * file handed to the agent is capped.
 *
 * Env: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER.
 * Uses the `gh` CLI for complete PR metadata plus `gh pr diff` (the files API
 * drops patches for large files and caps at 300 files).
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { appendOutput, appendSummary, repo } from "../docs-sync/lib.mjs"

const OUT_DIR = "v2-port-out"
const DIFF_CAP_BYTES = 200 * 1024
const SCOPE = "packages/opencode/"
const MARKER = "kilocode_change"
// A PR already tracked by hand carries the label the tracker would add.
const TRACKED_LABEL = "core-v1-changes-port"
const SKIP_LABEL = "no-v2-port"

/**
 * Parse a unified diff into `{ path, added }` per file. Path comes from the
 * `+++ b/...` header (falling back to the `diff --git` line for deletions, where
 * the new side is /dev/null).
 */
export function parseDiff(text) {
  const files = []
  let cur = null
  for (const line of String(text ?? "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      cur = { path: m ? m[2] : line.slice("diff --git ".length).trim(), added: [] }
      files.push(cur)
      continue
    }
    if (!cur) continue
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim()
      if (p && p !== "/dev/null") cur.path = p.replace(/^b\//, "")
      continue
    }
    if (line.startsWith("+")) cur.added.push(line.slice(1))
  }
  return files
}

/**
 * Qualification rule. `includes("kilocode")` covers src/kilocode/**, test/kilocode/**,
 * and any Kilo-named file, matching the annotation checker's exempt-path rule.
 */
export function qualifyDiff(text) {
  const files = parseDiff(text).filter((f) => f.path.startsWith(SCOPE))
  if (files.length === 0) {
    return { qualifies: false, reason: `diff touches nothing under ${SCOPE}`, matches: [] }
  }
  const paths = files.filter((f) => f.path.includes("kilocode")).map((f) => f.path)
  if (paths.length > 0) {
    return { qualifies: true, reason: `Kilo-owned opencode path changed: ${paths[0]}`, matches: paths }
  }
  const markers = files.filter((f) => f.added.some((l) => l.includes(MARKER))).map((f) => f.path)
  if (markers.length > 0) {
    return { qualifies: true, reason: `added a ${MARKER} marker in ${markers[0]}`, matches: markers }
  }
  return { qualifies: false, reason: `no Kilo-specific change under ${SCOPE}`, matches: [] }
}

/** Skip reason for PR metadata that should never reach the agent, or null. */
export function skipReason(pr, labels = []) {
  if (!pr) return "PR not found"
  if (!pr.mergedAt) return "PR is not merged"
  const login = pr.author?.login ?? "unknown"
  if (pr.author?.is_bot === true) return `author ${login} is a bot`
  if (labels.includes(SKIP_LABEL)) return `${SKIP_LABEL} label`
  if (labels.includes(TRACKED_LABEL)) return `${TRACKED_LABEL} label already applied`
  return null
}

/**
 * Cap the diff handed to the agent, cutting on a line boundary so the last line
 * is never half a hunk. Appends an explicit trailer so a truncated input is
 * never mistaken for the whole change.
 */
export function truncateDiff(text, cap = DIFF_CAP_BYTES) {
  const buf = Buffer.from(String(text ?? ""), "utf8")
  if (buf.length <= cap) return { text: String(text ?? ""), truncated: false, bytes: buf.length }
  const head = buf.subarray(0, cap).toString("utf8")
  const cut = head.lastIndexOf("\n")
  const safe = cut > 0 ? head.slice(0, cut) : head
  return { text: `${safe}\n\n[diff truncated: ${cap} of ${buf.length} bytes]\n`, truncated: true, bytes: buf.length }
}

function runGh(args, label) {
  const res = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (res.error) throw new Error(`${label} could not start: ${res.error.message}`)
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status}): ${String(res.stderr ?? "").trim()}`)
  return res.stdout ?? ""
}

function readPr(number) {
  const fields = [
    "number",
    "url",
    "title",
    "body",
    "state",
    "mergedAt",
    "mergeCommit",
    "author",
    "labels",
    "files",
    "commits",
    "comments",
    "reviews",
    "closingIssuesReferences",
  ].join(",")
  return JSON.parse(runGh(["pr", "view", String(number), "--repo", repo(), "--json", fields], `gh pr view #${number}`))
}

function readDiff(number) {
  return runGh(["pr", "diff", String(number), "--repo", repo(), "--patch"], `gh pr diff #${number}`)
}

async function main() {
  const number = Number(process.env.PR_NUMBER)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`PR_NUMBER is required, got ${process.env.PR_NUMBER}`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const pr = readPr(number)
  fs.writeFileSync(path.join(OUT_DIR, "pr.json"), JSON.stringify(pr, null, 2))

  appendOutput("author", pr.author?.login ?? "")
  appendOutput("title", pr.title ?? "")

  const labels = (pr.labels ?? []).map((l) => l.name)
  const skip = skipReason(pr, labels)
  if (skip) {
    console.log(`skip #${number}: ${skip}`)
    appendOutput("qualifies", "false")
    appendOutput("skip_reason", skip)
    appendSummary(`### v2-port tracker\n\nSkipped PR #${number}: ${skip}\n`)
    return
  }

  const full = readDiff(number)
  if (!full.trim()) {
    console.log(`skip #${number}: empty diff`)
    appendOutput("qualifies", "false")
    appendOutput("skip_reason", "empty diff")
    appendSummary(`### v2-port tracker\n\nSkipped PR #${number}: empty diff\n`)
    return
  }

  const verdict = qualifyDiff(full)
  const capped = truncateDiff(full)
  fs.writeFileSync(path.join(OUT_DIR, "pr.diff"), capped.text)
  if (capped.truncated) {
    console.warn(`::warning::diff truncated to ${DIFF_CAP_BYTES} of ${capped.bytes} bytes for the agent`)
  }

  appendOutput("qualifies", verdict.qualifies ? "true" : "false")
  appendOutput("skip_reason", verdict.qualifies ? "" : verdict.reason)
  console.log(verdict.qualifies ? `qualifies #${number}: ${verdict.reason}` : `skip #${number}: ${verdict.reason}`)
  appendSummary(
    [
      "### v2-port tracker",
      "",
      `- PR #${number}: \`${verdict.qualifies ? "qualifies" : "skipped"}\` — ${verdict.reason}`,
      `- diff: ${capped.bytes} bytes${capped.truncated ? " (truncated for the agent)" : ""}`,
      verdict.matches.length > 0 ? `- matched: ${verdict.matches.slice(0, 5).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  )
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
