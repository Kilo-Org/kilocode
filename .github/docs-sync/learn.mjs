// kilocode_change - new file

/**
 * Learns general rules of thumb from maintainer corrections to the docs-sync
 * bot's rolling pull request, and writes them into packages/kilo-docs/LEARNINGS.md
 * so the triage and edit passes follow them on every subsequent run.
 *
 * Two modes:
 *   node learn.mjs           — extraction: fetch corrections, call the model, validate
 *   node learn.mjs --apply   — apply: write learnings.json into LEARNINGS.md
 *
 * Env: TRIAGE_MODEL (provider/model, reused), GH_TOKEN (or GITHUB_TOKEN).
 * Budget: LEARNINGS_BUDGET_MINUTES (default 10).
 * Test hook: DOCS_SYNC_FIXTURE. When set to a fixture JSON path, skips every
 * GitHub API call and writes any marker PATCH to <fixture>.patched instead of
 * the network. The workflow never sets it — only selftests do.
 *
 * Test hook: DOCS_SYNC_BACKOFF_MS replaces wait between extraction retries, same as
 * lib.mjs:138 documents for triage.mjs and edit.mjs.
 *
 * Patch suppression: DRY_RUN=true or LEARNINGS_NO_PATCH=1 suppress the marker PATCH.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const LEARNINGS_FILE = "packages/kilo-docs/LEARNINGS.md"
const OUT_DIR = "docs-sync-out"
const ATTEMPTS = 2
const LEARNINGS_BUDGET_MINUTES = Number(process.env.LEARNINGS_BUDGET_MINUTES) || 10
const EXTRACTION_TIMEOUT_MS = LEARNINGS_BUDGET_MINUTES * 60 * 1000
const COMMENT_BODY_CAP = 5000

const HERE = path.dirname(fileURLToPath(import.meta.url))

const LINE_RE =
  /^- (?<rule>.+?) <!-- id=(?<id>[a-z0-9][a-z0-9-]{2,48}) scope=(?<scope>triage|edit|both) source=(?<source>commit:[0-9a-f]{7,40}|comment:\d+) date=(?<date>\d{4}-\d{2}-\d{2}) -->$/

const LEARNED_THROUGH_RE = /<!--\s*docs-sync:\s*learned-through\s+commit=(\S+)\s+comment=(\S+)\s*-->/

// Agent-generated strings land in the PR body next to machine-read markers.
// Identical to clean() at upsert-pr.mjs:37.
function clean(value) {
  return String(value ?? "")
    .replaceAll("<!--", "")
    .replaceAll("-->", "")
}

function warn(msg) {
  console.warn(`::warning::${msg}`)
}

function log(msg) {
  console.log(msg)
}

// --- pure exports ---

/**
 * Parse the LEARNINGS.md file text into an entry array.
 * Drops lines inside the markers that do not match the format.
 */
export function parseLearnings(text) {
  const m = String(text ?? "").match(
    /<!--\s*docs-sync:learnings:start\s*-->([\s\S]*?)<!--\s*docs-sync:learnings:end\s*-->/,
  )
  if (!m) return []
  const entries = []
  for (const line of m[1].split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = trimmed.match(LINE_RE)
    if (!parsed) {
      warn(`LEARNINGS.md: dropping unparseable line: ${trimmed.slice(0, 80)}`)
      continue
    }
    entries.push({
      id: parsed.groups.id,
      rule: clean(parsed.groups.rule).replaceAll("\n", " "),
      scope: parsed.groups.scope,
      source: parsed.groups.source,
      date: parsed.groups.date,
    })
  }
  return entries
}

/** Render the full LEARNINGS.md file text from an entry array. Deterministic order. */
export function renderLearnings(entries) {
  const list = [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const lines = list.map(
    (e) =>
      `- ${clean(e.rule).replaceAll("\n", " ")} <!-- id=${e.id} scope=${e.scope} source=${e.source} date=${e.date} -->`,
  )
  return [
    "# docs-sync learnings",
    "",
    "Rules the docs-sync bot learned from maintainer corrections to its rolling pull request.",
    "The bot reads this file at the start of every run and follows every rule below.",
    "",
    "To unlearn a rule, delete its line and commit. The next run reads this file from the",
    "branch, so the rule is gone from its input, and the deletion itself is a correction the",
    "extraction step is instructed not to undo.",
    "",
    "<!-- docs-sync:learnings:start -->",
    ...lines,
    "<!-- docs-sync:learnings:end -->",
    "",
  ].join("\n")
}

/** Parse the learned-through watermark from a PR body. Returns { commit, comment } with nulls for absent/none. */
export function parseLearnedThrough(body) {
  const m = String(body ?? "").match(LEARNED_THROUGH_RE)
  if (!m) return { commit: null, comment: null }
  const commit = m[1] === "none" ? null : m[1]
  const comment = m[2] === "none" ? null : m[2]
  return { commit, comment }
}

/** Render a single learned-through marker line. */
export function renderLearnedThrough({ commit, comment }) {
  const c = commit ?? "none"
  const m = comment ?? "none"
  return `<!-- docs-sync: learned-through commit=${c} comment=${m} -->`
}

/** Replace or append the learned-through marker in a PR body. Pure — no API call. */
export function patchMarkerIntoBody(body, marker) {
  const b = String(body ?? "")
  if (LEARNED_THROUGH_RE.test(b)) {
    return b.replace(LEARNED_THROUGH_RE, marker)
  }
  return b + "\n" + marker + "\n"
}

/**
 * Extract { add, remove } from raw model stdout.
 * Mirrors parseTriageEntries at extract-json.mjs:14-38, adapted for an object.
 * `kilo run` prints the assistant message twice; the last copy wins.
 * Walk "{" positions from right to left; return the first that parses to an object
 * holding an array `add` or an array `remove`.
 */
export function parseDelta(raw) {
  const r = String(raw ?? "")
  const end = r.lastIndexOf("}")
  if (end < 0) return null

  const starts = []
  for (let i = 0; i <= end; i++) {
    if (r[i] === "{") starts.push(i)
  }

  for (let s = starts.length - 1; s >= 0; s--) {
    let parsed
    try {
      parsed = JSON.parse(r.slice(starts[s], end + 1))
    } catch {
      continue
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue
    if (Array.isArray(parsed.add) || Array.isArray(parsed.remove)) {
      return {
        add: Array.isArray(parsed.add) ? parsed.add : [],
        remove: Array.isArray(parsed.remove) ? parsed.remove : [],
      }
    }
  }
  return null
}

/** Cap a review comment body so a single long comment cannot dominate extraction input. */
function capBody(body) {
  const b = String(body ?? "")
  if (b.length <= COMMENT_BODY_CAP) return b
  return b.slice(0, COMMENT_BODY_CAP) + " [truncated]"
}

/** Normalize rule text for duplicate comparison: lowercase, strip punctuation and whitespace runs. */
function norm(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Validate a delta against the existing entries and constraints.
 * Returns { add, remove, rejected }. Never throws.
 */
export function validateDelta(delta, { existing, candidateSources, deletedInWindow }) {
  const add = Array.isArray(delta.add) ? delta.add : []
  const remove = Array.isArray(delta.remove) ? delta.remove : []
  const ex = Array.isArray(existing) ? existing : []
  const candidates = Array.isArray(candidateSources) ? candidateSources : []
  const deleted = Array.isArray(deletedInWindow) ? deletedInWindow : []

  const rejected = []
  const valid = []
  const toRemove = []
  const existingIds = new Set(ex.map((e) => e.id))
  // One model response can repeat an id or a rule. Both would render two lines for
  // one id, so an accepted addition also blocks the next one.
  const acceptedIds = new Set()
  const acceptedRules = new Set()

  // Process remove first so toRemove is populated before the add loop checks
  // for id collisions with entries listed in remove (criterion 8).
  for (const id of remove) {
    if (!existingIds.has(id)) {
      rejected.push({ entry: { id, remove: id }, reason: `remove target ${id} not in existing entries` })
    } else {
      toRemove.push(id)
    }
  }

  for (const a of add) {
    let reason = null

    // Reject null, undefined, and non-object entries before any property access.
    if (a === null || a === undefined || typeof a !== "object" || Array.isArray(a)) {
      rejected.push({ entry: a, reason: "add entry is null, undefined, or not a plain object" })
      continue
    }

    if (!a.rule || String(a.rule).length < 10 || String(a.rule).length > 300) {
      reason = "rule text absent, shorter than 10 characters, or longer than 300"
    } else if (!["triage", "edit", "both"].includes(a.scope)) {
      reason = `invalid scope: ${a.scope}`
    } else if (!/^commit:[0-9a-f]{7,40}$/.test(a.source) && !/^comment:\d+$/.test(a.source)) {
      reason = `invalid source format: ${a.source}`
    } else if (!candidates.includes(a.source)) {
      reason = `source ${a.source} not in candidate sources`
    } else if (!/^[a-z0-9][a-z0-9-]{2,48}$/.test(a.id)) {
      reason = `invalid id format: ${a.id}`
    } else if (existingIds.has(a.id) && !toRemove.includes(a.id)) {
      reason = `id ${a.id} collides with an existing entry not listed in remove`
    } else if (acceptedIds.has(a.id)) {
      reason = `id ${a.id} collides with an earlier addition in this delta`
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) {
      reason = `invalid date format: ${a.date}`
    } else {
      // Check that date is a real calendar date.
      const d = new Date(a.date + "T00:00:00Z")
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== a.date) {
        reason = `invalid calendar date: ${a.date}`
      }
    }

    if (reason) {
      rejected.push({ entry: a, reason })
      continue
    }

    const n = norm(a.rule)

    // Duplicate of an existing entry not being removed.
    if (ex.some((e) => norm(e.rule) === n && !remove.includes(e.id))) {
      reason = `rule text is a duplicate of an existing entry not listed in remove`
      rejected.push({ entry: a, reason })
      continue
    }

    // Duplicate of an earlier addition in the same response.
    if (acceptedRules.has(n)) {
      reason = `rule text is a duplicate of an earlier addition in this delta`
      rejected.push({ entry: a, reason })
      continue
    }

    // Names a PR, URL, person, or docs page. The URL clause keeps docs-check-links.yml green.
    if (String(a.rule).match(/#\d{2,}|https?:\/\/|@[A-Za-z0-9-]|packages\/kilo-docs|\.md\b/)) {
      reason = "rule names a PR, URL, person, or docs page"
      rejected.push({ entry: a, reason })
      continue
    }

    // Duplicate of a rule deleted in this window.
    if (deleted.some((d) => norm(d) === n)) {
      reason = "rule text matches a line a maintainer deleted in this window"
      rejected.push({ entry: a, reason })
      continue
    }

    acceptedIds.add(a.id)
    acceptedRules.add(n)
    valid.push({
      id: a.id,
      rule: clean(String(a.rule)).replaceAll("\n", " "),
      scope: a.scope,
      source: a.source,
      date: a.date,
    })
  }

  return { add: valid, remove: toRemove, rejected }
}

/** Apply a validated delta to an existing entry array. Drops removed ids, appends adds. */
export function applyDelta(existing, delta) {
  const ex = Array.isArray(existing) ? existing : []
  const remove = new Set(Array.isArray(delta.remove) ? delta.remove : [])
  const add = Array.isArray(delta.add) ? delta.add : []
  return [...ex.filter((e) => !remove.has(e.id)), ...add]
}

/** Trust a review comment whose author_association is OWNER, MEMBER, or COLLABORATOR and is not a bot. */
export function isTrustedComment(comment) {
  if (!comment) return false
  const login = String(comment.user?.login ?? "")
  if (login.endsWith("[bot]")) return false
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(comment.author_association)
}

/** Render the prompt block for a given scope. Returns "" when no entry matches. */
export function promptBlock(entries, scope) {
  const matches = (Array.isArray(entries) ? entries : []).filter((e) => e.scope === scope || e.scope === "both")
  if (matches.length === 0) return ""
  return [
    "## Learnings from maintainer corrections",
    "",
    "Follow every rule below. Each was extracted from a correction a maintainer made to an",
    "earlier run of this bot. A rule here outranks a general instruction above when they conflict.",
    "",
    ...matches.map((e) => `- ${e.rule}`),
  ].join("\n")
}

/** Read a prompt block artifact from docs-sync-out. Returns the content or "" when absent. */
export function readLearningsBlock(scope) {
  const file = `${OUT_DIR}/learnings-${scope}.md`
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

// --- helpers for main ---

function git(args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "inherit"] })
    .toString()
    .trim()
}

// --- main ---

async function main() {
  // Step 0: ensure docs-sync-out exists. collect.mjs:139 is the only other unconditional
  // mkdirSync of this directory, and it runs after the learn step. Without this line the
  // empty-candidate path throws ENOENT on its first write, continue-on-error swallows it,
  // and the feature silently never works.
  fs.mkdirSync(OUT_DIR, { recursive: true })

  if (process.argv.includes("--apply")) {
    await apply()
    return
  }

  await extract()
}

// --- apply mode ---

async function apply() {
  const learningsPath = `${OUT_DIR}/learnings.json`
  if (!fs.existsSync(learningsPath)) {
    log("learnings.json absent — extraction was skipped or failed; nothing to apply")
    return
  }
  const entries = JSON.parse(fs.readFileSync(learningsPath, "utf8"))
  const file = renderLearnings(entries)
  fs.writeFileSync(LEARNINGS_FILE, file)
  log(`wrote ${LEARNINGS_FILE} with ${entries.length} entries`)
}

// --- extraction mode ---

async function extract() {
  // Step 0: seed the prompt artifacts from the checked-out file before any fallible
  // work. Every later step can throw, the workflow step is continue-on-error, and
  // triage and edit read only these two files. Without the seed one failed API call
  // silently drops every learned rule for the whole run. Later steps replace them
  // with the rolling-branch copy and then with the validated delta.
  writePromptArtifacts(parseLearnings(readFileOrEmpty(LEARNINGS_FILE)))

  // Load fixture when DOCS_SYNC_FIXTURE is set.
  const fixturePath = process.env.DOCS_SYNC_FIXTURE
  let fixture = null
  let patchFile = null
  if (fixturePath) {
    fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"))
    patchFile = fixturePath + ".patched"
  }

  const { api, repo, searchIssues, appendOutput, appendSummary, backoffMsForAttempt, runKilo, sleepSync } =
    await import("./lib.mjs")

  let prData
  let prBody = ""
  let prNumber = ""
  let branch = ""

  if (fixture) {
    // Fixture mode: skip all API calls.
    prData = fixture.pr
    prBody = prData.body ?? ""
    prNumber = String(prData.number ?? 1)
    branch = prData.head?.ref ?? "docs/auto-sync"
  } else {
    // Step 1: resolve the rolling PR. Use prepare-branch.mjs's selection rule so both
    // target the same branch. searchIssues takes prs[0] with no author filter (like
    // prepare-branch.mjs:69). But trust the body marker only when authored by
    // github-actions[bot] (like watermark.mjs:35). The two rules differ on purpose:
    // the branch must match what prepare-branch.mjs will check out, but a body is
    // editable so its marker needs the author filter.
    const r = repo()
    const prs = await searchIssues(`repo:${r} is:pr is:open label:auto-docs sort:created-desc`, { maxPages: 1 })
    if (prs.length === 0) {
      log("no open rolling pull request — nothing to learn from")

      // Read existing learnings from main for empty-state artifacts.
      let existing = []
      try {
        const existingText = git(["show", `origin/main:${LEARNINGS_FILE}`])
        existing = parseLearnings(existingText)
      } catch {
        existing = []
      }
      log(`no-PR existing entries from main: ${existing.length}`)
      writeEmptyStateArtifacts(existing)
      appendOutput("count", String(existing.length))
      appendSummary("### docs-sync learnings\n\nNo open auto-docs pull request; extraction skipped.")
      return
    }
    prData = await api(`/repos/${r}/pulls/${prs[0].number}`)
    prBody = prData.body ?? ""
    prNumber = String(prData.number)
    branch = prData.head?.ref ?? "docs/auto-sync"
  }

  // Step 2: read existing entries.
  let existing = []
  let existingText = ""
  if (fixture) {
    existingText = readFileOrEmpty(LEARNINGS_FILE)
    existing = parseLearnings(existingText)
  } else {
    try {
      existingText = git(["show", `origin/${branch}:${LEARNINGS_FILE}`])
    } catch {
      // branch copy absent — fall back to main, then empty.
      // Required for the first live run: the rolling branch predates the seeded file.
      try {
        existingText = git(["show", `origin/main:${LEARNINGS_FILE}`])
      } catch {
        existingText = ""
      }
    }
    existing = parseLearnings(existingText)
  }
  log(`existing entries: ${existing.length}`)

  // Replace the seed with the rolling-branch copy. Every step below can throw, and
  // these two files are all triage and edit read.
  writePromptArtifacts(existing)

  // Step 3: parse marker. Trust only when authored by github-actions[bot] (like watermark.mjs:35).
  let commitWm = null
  let commentWm = null
  const trusted = prData.user?.login === "github-actions[bot]"
  if (trusted) {
    ;({ commit: commitWm, comment: commentWm } = parseLearnedThrough(prBody))
  } else {
    log("PR author is not github-actions[bot]; ignoring body marker")
  }
  log(`watermark: commit=${commitWm ?? "none"} comment=${commentWm ?? "none"}`)

  // Step 4: fetch and tip SHA.
  let tipSha
  if (fixture) {
    tipSha = git(["rev-parse", "HEAD"])
  } else {
    git(["fetch", "origin", "main", branch])
    tipSha = git(["rev-parse", `origin/${branch}`])
  }

  // Step 5: candidate commits.
  let rangeArgs = [`origin/main..origin/${branch}`]
  if (fixture) {
    // In fixture mode, work from the local repo state.
    try {
      git(["rev-parse", "--verify", branch])
      rangeArgs = [`origin/main..${branch}`]
    } catch {
      rangeArgs = [`origin/main..HEAD`]
    }
  }

  if (commitWm) {
    let wmExists = false
    try {
      git(["cat-file", "-e", `${commitWm}^{commit}`])
      wmExists = true
    } catch {
      wmExists = false
    }
    if (wmExists) {
      rangeArgs.push(`^${commitWm}`)
    }
    // A missing watermark commit (force-push, rebase) drops the exclusion.
    // The duplicate-rule-text rejection in validateDelta blocks the re-added duplicate.
  }

  const logOut = git(["log", "--no-merges", "--format=%H|%ae|%cI|%s", ...rangeArgs])
  const rawCommits = logOut ? logOut.split("\n").filter(Boolean) : []

  const botEmail = "41898282+github-actions[bot]@users.noreply.github.com"
  const candidates = []
  const candidateSources = []
  const deletedInWindow = []

  for (const line of rawCommits) {
    const [sha, email, dateIso] = line.split("|")
    // Drop commits authored by the sync job itself (criterion 5).
    if (email === botEmail) continue
    // Everything reachable from main is already excluded by the range (criterion 6).

    // Get the full file list.
    let files = []
    try {
      const out = git(["show", "--name-only", "--format=", sha])
      files = out
        ? out
            .split("\n")
            .filter(Boolean)
            .filter((f) => f)
        : []
    } catch {
      continue
    }

    // Get the docs-scoped diff and message.
    let message = ""
    let docDiff = ""
    try {
      message = git(["show", "--format=%B", "--no-patch", sha]).trim()
      docDiff = git(["show", "--format=", sha, "--", "packages/kilo-docs"])
      // Cap diff sizes.
      if (docDiff.length > 20000) docDiff = docDiff.slice(0, 20000) + "\n[truncated]"
    } catch {
      // skip on error
    }

    // Drop commits whose docs-scoped diff is empty.
    if (!docDiff.trim()) continue

    // Collect deleted rule lines from LEARNINGS.md.
    for (const dl of docDiff.split("\n")) {
      if (!dl.startsWith("-")) continue
      const stripped = dl.slice(1).trim()
      const parsed = stripped.match(LINE_RE)
      if (parsed) {
        deletedInWindow.push(clean(parsed.groups.rule).replaceAll("\n", " "))
      }
    }

    // Cap total diff data.
    const totalDiff = candidates.reduce((n, c) => n + (c.diff ? c.diff.length : 0), 0)
    if (totalDiff > 120000) {
      log(`diff cap reached at commit ${sha.slice(0, 7)}; truncating`)
      candidates.push({
        source: `commit:${sha.slice(0, 7)}`,
        iso: dateIso,
        date: dateIso.slice(0, 10),
        message,
        files,
        diff: "[truncated]",
      })
      candidateSources.push(`commit:${sha.slice(0, 7)}`)
      break
    }

    candidates.push({
      source: `commit:${sha.slice(0, 7)}`,
      iso: dateIso,
      date: dateIso.slice(0, 10),
      message,
      files,
      diff: docDiff,
    })
    candidateSources.push(`commit:${sha.slice(0, 7)}`)
  }

  // Step 6: candidate comments.
  let allComments = []
  let maxCommentAt = "none"

  if (fixture && fixture.comments) {
    allComments = fixture.comments
  } else if (prNumber) {
    const pages = []
    for (let page = 1; page <= 5; page++) {
      const batch = await api(`/repos/${repo()}/pulls/${prNumber}/comments?per_page=100&page=${page}`)
      pages.push(...batch)
      if (batch.length < 100) break
    }
    allComments = pages
  }

  if (allComments.length > 0) {
    let max = ""
    for (const c of allComments) {
      if (c.created_at && c.created_at > max) max = c.created_at
    }
    maxCommentAt = max || "none"
  }

  // Filter trusted comments.
  const trustedComments = allComments.filter((c) => {
    if (!isTrustedComment(c)) return false
    if (commentWm && c.created_at <= commentWm) return false
    return true
  })

  // Step 7: correlate comments to commits.
  // A comment is a commit's trigger when c.path is in that commit's full file list
  // and c.created_at < commit date. The earliest such commit claims it.
  // Compare parsed timestamps so different timezone offsets do not skew the ordering.
  for (const c of trustedComments) {
    let best = null
    const cTime = Date.parse(c.created_at)
    for (const cc of candidates) {
      if (!Array.isArray(cc.files) || !cc.files.includes(c.path)) continue
      const ccTime = Date.parse(cc.iso)
      if (cTime < ccTime) {
        if (!best || ccTime < Date.parse(best.iso)) {
          best = cc
        }
      }
    }
    if (best) {
      best.comment = {
        author_association: c.author_association,
        path: c.path,
        body: capBody(c.body),
      }
    } else {
      candidates.push({
        source: `comment:${c.id}`,
        date: (c.created_at ?? "").slice(0, 10),
        path: c.path,
        body: capBody(c.body),
        author_association: c.author_association,
      })
      candidateSources.push(`comment:${c.id}`)
    }
  }

  // Step 8: no candidates → empty delta route.
  const hasCandidates = candidates.length > 0

  if (!hasCandidates) {
    log("no candidate corrections; advancing marker with no model call")
    writeEmptyStateArtifacts(existing)
    appendOutput("count", String(existing.length))
    appendSummary(
      `### docs-sync learnings\n\nNo new candidate corrections. Entries: ${existing.length}. Marker route: empty (no candidates).`,
    )

    const marker = renderLearnedThrough({ commit: tipSha, comment: maxCommentAt })
    await patchOrLogMarker({ prBody, prNumber, marker, fixture, patchFile })
    return
  }

  // Step 9: write learnings input.
  const input = {
    existing: existing.map((e) => ({ id: e.id, rule: e.rule, scope: e.scope, source: e.source, date: e.date })),
    deleted_in_window: deletedInWindow,
    corrections: candidates,
  }
  const inputFile = `${OUT_DIR}/learnings-input.json`
  fs.writeFileSync(inputFile, JSON.stringify(input, null, 2))
  log(`wrote ${inputFile} with ${candidates.length} candidates`)

  // Step 10: call the model.
  // Deliberately no --auto. Every input is in the attached file and the output goes to
  // stdout, so the agent needs no tool. Omitting --auto makes "the extraction step never
  // writes outside LEARNINGS.md" structurally true instead of prompt-deep. triage.mjs:76
  // and edit.mjs:86 carry the opposite comment; do not copy them without updating the reason.
  const prompt = fs.readFileSync(path.join(HERE, "learnings-prompt.md"), "utf8")
  const model = process.env.TRIAGE_MODEL
  if (!model) throw new Error("TRIAGE_MODEL is required")

  const budgetDeadline = Date.now() + EXTRACTION_TIMEOUT_MS

  let raw = null
  let lastCause = "extraction failed"

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const left = Math.max(0, budgetDeadline - Date.now())
    if (left <= 0) {
      log("budget exhausted before extraction attempt")
      break
    }

    const result = runKilo({
      args: ["run", prompt, "-m", model, "--dir", process.cwd(), "-f", inputFile],
      timeoutMs: Math.min(EXTRACTION_TIMEOUT_MS, left),
      streamStdout: false,
      label: "learnings extraction",
    })

    if (result.stdout) {
      fs.writeFileSync(`${OUT_DIR}/learnings-raw.txt`, result.stdout)
      raw = result.stdout
      const delta = parseDelta(raw)
      if (delta) break
      lastCause = `parseDelta returned null (attempt ${attempt})`
    } else {
      lastCause = result.timedOut ? "timed out" : `exit ${result.exitCode}`
    }

    if (attempt < ATTEMPTS) {
      const wait = backoffMsForAttempt(1) // 60s, same as the sibling convention
      if (wait > 0) {
        log(`backing off ${wait / 1000}s before attempt ${attempt + 1}`)
        sleepSync(wait)
      }
    }
  }

  // Step 11: parse and validate.
  const delta = raw ? parseDelta(raw) : null

  if (!delta) {
    // parseDelta null after every try — retryable unhappy.
    warn(`extraction failed: ${lastCause}. Leaving learnings untouched.`)
    writeEmptyStateArtifacts(existing)
    appendOutput("count", String(existing.length))
    appendSummary(
      `### docs-sync learnings\n\nExtraction failed: ${lastCause}. Entries unchanged: ${existing.length}. No marker advance.`,
    )
    return
  }

  const validated = validateDelta(delta, { existing, candidateSources, deletedInWindow })

  if (validated.rejected.length > 0) {
    for (const r of validated.rejected) {
      warn(`rejected: ${r.reason}` + (r.entry?.id ? ` (id=${r.entry.id})` : ""))
    }
  }

  const nonEmpty = validated.add.length > 0 || validated.remove.length > 0

  // Step 12: route by outcome (G5 table, exact).
  if (nonEmpty) {
    // Non-empty validated delta.
    const newEntries = applyDelta(existing, { add: validated.add, remove: validated.remove })
    fs.writeFileSync(`${OUT_DIR}/learnings.json`, JSON.stringify(newEntries, null, 2))
    const marker = renderLearnedThrough({ commit: tipSha, comment: maxCommentAt })
    const suppressed = process.env.DRY_RUN === "true" || process.env.LEARNINGS_NO_PATCH === "1"
    if (!suppressed) appendOutput("learned_through", marker)
    if (suppressed) log(`learned-through output suppressed: ${marker}`)

    const added = validated.add.length
    const removed = validated.remove.length
    const rejected = validated.rejected.length
    log(`delta: +${added} -${removed} (${rejected} rejected)`)
    appendSummary(
      `### docs-sync learnings\n\n- added: ${added}\n- removed: ${removed}\n- rejected: ${rejected}\n- candidates: ${candidates.length}\n- marker route: upsert (non-empty delta)\n`,
    )

    writePromptArtifacts(newEntries)
    appendOutput("count", String(newEntries.length))

    // Marker rides through LEARNED_THROUGH into upsert-pr.mjs. No direct PATCH.
  } else {
    // Empty validated delta (nothing added, nothing removed, including every-add-rejected).
    log("empty validated delta; advancing marker directly")
    fs.writeFileSync(`${OUT_DIR}/learnings.json`, JSON.stringify(existing, null, 2))
    writePromptArtifacts(existing)
    appendOutput("count", String(existing.length))

    const marker = renderLearnedThrough({ commit: tipSha, comment: maxCommentAt })
    await patchOrLogMarker({ prBody, prNumber, marker, fixture, patchFile })

    const rejected = validated.rejected.length
    appendSummary(
      `### docs-sync learnings\n\n- added: 0\n- removed: 0\n- rejected: ${rejected}\n- candidates: ${candidates.length}\n- marker route: direct PATCH (empty delta)\n`,
    )
  }
}

// --- shared helpers ---

function writeEmptyStateArtifacts(entries) {
  fs.writeFileSync(`${OUT_DIR}/learnings.json`, JSON.stringify(entries, null, 2))
  writePromptArtifacts(entries)
}

// A later call must be able to shrink a seeded block back to nothing, so an empty
// block removes the file instead of leaving the earlier content in place.
function writePromptArtifacts(entries) {
  writeOrRemove(`${OUT_DIR}/learnings-triage.md`, promptBlock(entries, "triage"))
  writeOrRemove(`${OUT_DIR}/learnings-edit.md`, promptBlock(entries, "edit"))
}

function writeOrRemove(file, text) {
  if (text) fs.writeFileSync(file, text)
  else fs.rmSync(file, { force: true })
}

function readFileOrEmpty(file) {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

async function patchOrLogMarker({ prBody, prNumber, marker, fixture, patchFile }) {
  const suppressed = process.env.DRY_RUN === "true" || process.env.LEARNINGS_NO_PATCH === "1"

  if (suppressed) {
    log(
      `marker PATCH suppressed (DRY_RUN=${process.env.DRY_RUN}, LEARNINGS_NO_PATCH=${process.env.LEARNINGS_NO_PATCH})`,
    )
    log(`would have written marker: ${marker}`)
    return
  }

  if (fixture) {
    // Write to the fixture patch file instead of the network.
    fs.writeFileSync(patchFile, marker)
    log(`wrote marker to ${patchFile}`)
    return
  }

  // Live PATCH: body-only, one line changed. The job already holds pull-requests: write.
  // Re-read the body first. The body in hand was fetched before the extraction call, so
  // patching that copy would drop any edit made in the minutes since. GitHub has no
  // conditional update for a pull request body, so a short fetch-to-PATCH race remains.
  const { api, repo } = await import("./lib.mjs")
  let latestBody = prBody
  try {
    const fresh = await api(`/repos/${repo()}/pulls/${prNumber}`)
    latestBody = fresh.body ?? ""
  } catch (err) {
    warn(`could not re-read PR #${prNumber} before the marker PATCH: ${err.message}. Using the earlier body.`)
  }
  const newBody = patchMarkerIntoBody(latestBody, marker)
  await api(`/repos/${repo()}/pulls/${prNumber}`, {
    method: "PATCH",
    body: { body: newBody },
  })
  log(`PATCHed learned-through marker on PR #${prNumber}`)
}

// --- entry point ---

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

// --- self-test harness (run: node .github/docs-sync/learn.mjs --self-test) ---
if (isMain && process.argv.includes("--self-test")) {
  const failures = []
  const check = (label, fn) => {
    try {
      const ok = fn()
      if (!ok) failures.push(label)
    } catch (e) {
      failures.push(label + " THREW: " + e.message)
    }
  }

  check("null in add does not throw", () => {
    const r = validateDelta({ add: [null], remove: [] }, { existing: [], candidateSources: [], deletedInWindow: [] })
    return r.add.length === 0 && r.rejected.length === 1 && r.rejected[0].reason.includes("not a plain object")
  })

  check("undefined in add does not throw", () => {
    const r = validateDelta(
      { add: [undefined], remove: [] },
      { existing: [], candidateSources: [], deletedInWindow: [] },
    )
    return r.add.length === 0 && r.rejected.length === 1 && r.rejected[0].reason.includes("not a plain object")
  })

  check("mixed valid and null retains valid", () => {
    const r = validateDelta(
      {
        add: [
          {
            id: "valid-a",
            rule: "Do not document experimental features",
            scope: "both",
            source: "commit:bbbbbbb",
            date: "2026-08-03",
          },
          null,
          {
            id: "valid-b",
            rule: "Keep release notes concise",
            scope: "edit",
            source: "commit:bbbbbbb",
            date: "2026-08-03",
          },
        ],
        remove: [],
      },
      { existing: [], candidateSources: ["commit:bbbbbbb"], deletedInWindow: [] },
    )
    return r.add.length === 2 && r.rejected.length === 1
  })

  if (failures.length) {
    console.error("SELF-TEST FAILURES:", failures)
    process.exit(1)
  }
  console.log("SELF-TEST PASSED (" + 3 + " checks)")
  process.exit(0)
}

if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
