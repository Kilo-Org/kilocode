// kilocode_change - new file

/**
 * Deterministic half of the v2-port tracker: turns the agent's draft into a
 * GitHub tracking issue.
 *
 * The agent is steered by untrusted PR content, so it never touches GitHub. It
 * writes v2-port-out/{title.txt,body.md} (or skip.txt), and this script does
 * every mutation: draft validation, duplicate detection, label ensure, issue
 * creation, assignee resolution, and the back-link comment on the source PR.
 *
 * Idempotency is by marker, not by search: the issue body carries
 * `<!-- v2-port:pr-<N> -->` and the PR comment carries `<!-- v2-port:comment -->`,
 * so re-running after a partial failure updates instead of duplicating.
 *
 * Env: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, DRY_RUN.
 * Reads v2-port-out/pr.json for the source PR metadata.
 */

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { api, appendOutput, appendSummary, repo } from "../docs-sync/lib.mjs"

const OUT_DIR = "v2-port-out"
const LABEL = "core-v1-changes-port"
const LABEL_COLOR = "5319e7"
const LABEL_DESCRIPTION = "Kilo core v1 change to re-implement or verify in opencode v2"
const COMMENT_MARKER = "<!-- v2-port:comment -->"
const MAX_TITLE = 80

// The skill's body template, in order. Each must appear exactly once.
export const HEADINGS = [
  "## Context",
  "## Problem In V1",
  "## Behavior To Preserve In V2",
  "## Non-Goals",
  "## Why This May Not Carry Over Automatically",
  "## Acceptance Criteria",
  "## V1 Reference",
  "## Prompt For V2 Agent",
]

/**
 * Placeholder detector for the skill's `<...>` slots. Deliberately narrow: the
 * inner text must look like prose (letters, digits, spaces, `,:.-`), so code
 * generics (`Promise<void>`, preceded by a word char), self-closing tags
 * (`<div/>`), autolinks (`<https://…>`), and HTML comments (`<!-- … -->`) do not
 * trip it. This runs on the agent's body only — the provenance banner is added
 * after validation.
 */
const PLACEHOLDER = /(^|[\s(>*_#-])<([A-Za-z0-9][A-Za-z0-9 ,:.-]{0,159})>/g

export function markerFor(number) {
  return `<!-- v2-port:pr-${number} -->`
}

export function findPlaceholders(body) {
  const found = []
  for (const m of String(body ?? "").matchAll(PLACEHOLDER)) {
    if (!found.includes(m[2])) found.push(m[2])
  }
  return found.map((inner) => `<${inner}>`)
}

export function headingCounts(body) {
  const counts = {}
  for (const h of HEADINGS) counts[h] = 0
  for (const line of String(body ?? "").split("\n")) {
    const trimmed = line.trim()
    if (counts[trimmed] !== undefined) counts[trimmed]++
  }
  return counts
}

/** Returns a list of problems; empty means the draft may be filed. */
export function validateDraft(title, body) {
  const errs = []
  const clean = String(title ?? "").trim()
  if (!clean) errs.push("title is empty")
  else if (!clean.startsWith("[v2-port] ")) errs.push(`title must start with "[v2-port] ": ${clean}`)

  const text = String(body ?? "")
  if (!text.trim()) {
    errs.push("body is empty")
    return errs
  }

  const counts = headingCounts(text)
  for (const h of HEADINGS) {
    if (counts[h] === 0) errs.push(`missing section: ${h}`)
    else if (counts[h] > 1) errs.push(`section appears ${counts[h]} times: ${h}`)
  }

  const placeholders = findPlaceholders(text)
  if (placeholders.length > 0) errs.push(`unresolved placeholders: ${placeholders.slice(0, 8).join(", ")}`)
  return errs
}

/** Record the author in V1 Reference. Plain text, never an @-mention. */
export function withAuthor(body, author, assignable) {
  const text = String(body ?? "")
  if (!author) return text
  const line = `- Author: ${author}${assignable ? "" : " (not assignable — issue left unassigned)"}`
  const lines = text.split("\n")
  const idx = lines.findIndex((l) => l.trim() === "## V1 Reference")
  if (idx === -1) return `${text.trimEnd()}\n\n## V1 Reference\n\n${line}\n`
  lines.splice(idx + 1, 0, "", line)
  return lines.join("\n")
}

export function buildBody({ number, url, author, assignable, body }) {
  const banner = [
    markerFor(number),
    `> Auto-created by the \`v2-port-tracker\` workflow from Kilo v1 PR #${number} (${url}) for the`,
    "> opencode v2 rewrite. The summary below is generated from that PR's changes, tests, and discussion —",
    "> review it before planning.",
    "",
  ].join("\n")
  return `${banner}${withAuthor(body, author, assignable)}`
}

export function backLinkComment(issueNumber) {
  return `${COMMENT_MARKER}\nTracked for the opencode v2 rewrite in #${issueNumber} (\`${LABEL}\`).`
}

function readRequired(name) {
  const file = path.join(OUT_DIR, name)
  if (!fs.existsSync(file)) throw new Error(`agent produced neither ${name} nor skip.txt`)
  const text = fs.readFileSync(file, "utf8")
  if (!text.trim()) throw new Error(`${name} is empty`)
  return text.trim()
}

/**
 * Find an existing tracking issue for this PR. Scans the label set and matches
 * the body marker locally: a `--search "pull/<N>"` query tokenizes the PR
 * reference unreliably, so the marker is the only trustworthy key.
 */
export async function findExisting(number) {
  const marker = markerFor(number)
  for (let page = 1; page <= 10; page++) {
    const items = await api(`/repos/${repo()}/issues?labels=${encodeURIComponent(LABEL)}&state=all&per_page=100&page=${page}`)
    const hit = (items ?? []).find(
      (i) => !i.pull_request && typeof i.body === "string" && i.body.includes(marker),
    )
    if (hit) return hit
    if ((items ?? []).length < 100) return null
  }
  return null
}

async function ensureLabel() {
  try {
    await api(`/repos/${repo()}/labels`, {
      method: "POST",
      body: { name: LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION },
    })
    console.log(`created label ${LABEL}`)
  } catch (err) {
    if (err.status === 422) {
      console.log(`label ${LABEL} already exists`)
      return
    }
    throw err
  }
}

/** GitHub only accepts assignees with repo access; 404 means not assignable. */
export async function isAssignable(login) {
  if (!login) return false
  try {
    await api(`/repos/${repo()}/assignees/${encodeURIComponent(login)}`)
    return true
  } catch (err) {
    if (err.status === 404) return false
    throw err
  }
}

async function upsertComment(number, issueNumber) {
  const body = backLinkComment(issueNumber)
  let existing = null
  for (let page = 1; page <= 5 && !existing; page++) {
    const comments = await api(`/repos/${repo()}/issues/${number}/comments?per_page=100&page=${page}`)
    existing = (comments ?? []).find((c) => typeof c.body === "string" && c.body.includes(COMMENT_MARKER)) ?? null
    if ((comments ?? []).length < 100) break
  }
  if (existing) {
    await api(`/repos/${repo()}/issues/comments/${existing.id}`, { method: "PATCH", body: { body } })
    console.log(`updated back-link comment ${existing.id}`)
    return
  }
  await api(`/repos/${repo()}/issues/${number}/comments`, { method: "POST", body: { body } })
  console.log("created back-link comment")
}

async function main() {
  const number = Number(process.env.PR_NUMBER)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`PR_NUMBER is required, got ${process.env.PR_NUMBER}`)
  const dryRun = String(process.env.DRY_RUN ?? "") === "true"

  const skipFile = path.join(OUT_DIR, "skip.txt")
  if (fs.existsSync(skipFile)) {
    const reason = fs.readFileSync(skipFile, "utf8").trim()
    console.log(`agent skipped #${number}: ${reason}`)
    appendOutput("skipped", "true")
    appendSummary(`### v2-port tracker\n\nAgent skipped PR #${number}: ${reason}\n`)
    return
  }

  // First non-empty line: models sometimes prefix the file with a blank line.
  const title = readRequired("title.txt").split("\n").map((l) => l.trim()).find(Boolean) ?? ""
  const body = readRequired("body.md")
  const pr = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "pr.json"), "utf8"))
  const url = pr.url ?? `https://github.com/${repo()}/pull/${number}`
  const author = pr.author?.login ?? ""

  if (title.length > MAX_TITLE) {
    console.warn(`::warning::title is ${title.length} chars; the skill asks for under ${MAX_TITLE}`)
  }
  const errors = validateDraft(title, body)
  const assignable = await isAssignable(author)

  if (dryRun) {
    console.log(`--- title ---\n${title}`)
    console.log(`--- author ${author || "(unknown)"}: assignable=${assignable}`)
    console.log(`--- body (first 40 lines) ---\n${body.split("\n").slice(0, 40).join("\n")}`)
    if (errors.length > 0) {
      for (const e of errors) console.error(`::error::${e}`)
      throw new Error(`draft is invalid (${errors.length} problem(s)); nothing was created`)
    }
    console.log("dry run: nothing created")
    appendSummary(`### v2-port tracker (dry run)\n\nWould file \`${title}\` for PR #${number}.\n`)
    return
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::${e}`)
    throw new Error(`refusing to file an invalid issue (${errors.length} problem(s))`)
  }

  const existing = await findExisting(number)
  if (existing) {
    console.log(`already tracked: ${existing.html_url}`)
    appendOutput("issue_url", existing.html_url)
    appendSummary(`### v2-port tracker\n\nPR #${number} is already tracked in ${existing.html_url}; nothing created.\n`)
    return
  }

  await ensureLabel()
  if (!assignable) console.warn(`::warning::${author || "unknown author"} is not assignable; issue left unassigned`)

  const issue = await api(`/repos/${repo()}/issues`, {
    method: "POST",
    body: { title, body: buildBody({ number, url, author, assignable, body }), labels: [LABEL], assignees: assignable ? [author] : [] },
  })
  console.log(`created issue #${issue.number}: ${issue.html_url}`)
  await upsertComment(number, issue.number)

  appendOutput("issue_url", issue.html_url)
  appendSummary(
    `### v2-port tracker\n\nFiled ${issue.html_url} for PR #${number}.\n- assignee: ${assignable ? author : "none (author not assignable)"}\n`,
  )
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
