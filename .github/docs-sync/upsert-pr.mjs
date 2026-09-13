// kilocode_change - new file

/**
 * Commits the agent's packages/kilo-docs changes, pushes the rolling
 * integration branch, and maintains one auto-docs PR per product surface
 * (plus one `other` PR).
 *
 * The integration branch (`BRANCH`, normally `docs/auto-sync`) accumulates the
 * whole docs tree and has no PR of its own. Every surface PR is rebuilt in a
 * throwaway worktree that carries only that surface's changed files, so a file
 * belongs to exactly one PR. Per-surface git and API work is caught: one
 * surface's failure warns and continues and cannot lose another surface's
 * changes or stall the watermark.
 *
 * Watermark invariant: processed-through never moves past a PR that has no
 * terminal outcome. Terminal := action !== "pending" (a deliberate agent
 * "skipped" IS terminal). Uncovered PRs hold the marker at earliest
 * merged_at − 1 ms so collect's merged:>=since re-collects them next run.
 * Three review rounds found four independent defects in a queue-based
 * alternative (unreachable gate, empty-PR creation, cap-overflow loss,
 * draft-state corruption); a held-back watermark has none of those modes.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  OTHER,
  derivation,
  groupBySurface,
  loadSurfaceMap,
  otherDocPrefixes,
  surfaceBranch,
  surfaceDocPrefixes,
  surfaceForDoc,
  surfaceNames,
  surfaceSourcePrefixes,
} from "./surfaces.mjs"
import { computeSurfaceReviewers } from "./reviewers.mjs"

export { surfaceBranch }

const BRANCH = process.env.BRANCH || "docs/auto-sync"
// Git refs cannot hold both `docs/auto-sync` and `docs/auto-sync/<surface>`: a
// ref may not be a path prefix of another ref. Surface PRs therefore use the
// required `docs/auto-sync/<surface>` heads, and the integration tree is pushed
// to this sibling ref purely for durability (a failed surface cannot lose the
// run's changes).
const INTEGRATION_BRANCH = process.env.INTEGRATION_BRANCH || "docs/auto-sync-integration"
const FILE_CAP = 15
const ROW_CAP = 150
const PENDING_DISPLAY_CAP = 60
const SUMMARY_FILE = ".docs-sync-summary.json"
const DOCS_PATH = "packages/kilo-docs"
const MAP_FILE = ".github/docs-sync/surfaces.json"
export const LEARNINGS_FILE = "packages/kilo-docs/LEARNINGS.md"

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim()

// Agent-generated strings land in the PR body next to machine-read markers.
// Strip HTML-comment sequences so a crafted/adversarial value cannot forge
// section boundaries or the processed-through watermark.
function clean(value) {
  return String(value ?? "")
    .replaceAll("<!--", "")
    .replaceAll("-->", "")
}

function shortRef(url) {
  return clean(url).replace("https://github.com/", "").replace("/pull/", "#")
}

function changeRow(e) {
  return `| ${clean(e.action).replaceAll("|", "\\|")} | [${shortRef(e.url)}](${clean(e.url)}) |`
}

function skippedRow(e) {
  const reason = clean(e.reason).replaceAll("|", "\\|").replaceAll("\n", " ")
  return `| [${shortRef(e.url)}](${clean(e.url)}) | ${reason} |`
}

function pendingRow(e) {
  const reason = clean(e.reason ?? e.cause ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
  return `| [${shortRef(e.url)}](${clean(e.url)}) | ${reason} |`
}

export function extractSectionRows(body, name) {
  const m = String(body ?? "").match(
    new RegExp(`<!--\\s*docs-sync:${name}:start\\s*-->([\\s\\S]*?)<!--\\s*docs-sync:${name}:end\\s*-->`),
  )
  if (!m) return []
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.startsWith("|") &&
        !l.startsWith("| ---") &&
        !/^\|\s*Docs change/.test(l) &&
        !/^\|\s*PR\s*\|/.test(l) &&
        !/^\|\s*Why\s*\|/.test(l),
    )
}

function section(name, header, rows) {
  const body = rows.length > 0 ? [header, "| --- | --- |", ...rows].join("\n") : "_None._"
  return `<!-- docs-sync:${name}:start -->\n${body}\n<!-- docs-sync:${name}:end -->`
}

export function renderBody({
  date,
  since,
  through,
  learnedThrough = "",
  changesRows,
  pendingRows,
  skippedRows,
  verified,
  draftReasons,
  note,
  surfaceBlock = "",
}) {
  const pendingDisplay =
    pendingRows.length > PENDING_DISPLAY_CAP
      ? [...pendingRows.slice(0, PENDING_DISPLAY_CAP), `| +${pendingRows.length - PENDING_DISPLAY_CAP} more | |`]
      : pendingRows

  return `## Automated docs sync — ${date}

This PR keeps kilo.ai/docs in sync with features merged to [Kilo-Org/cloud](https://github.com/Kilo-Org/cloud) and [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode). Every change below links to the merged PR it documents.

- Window: \`${since}\` → \`${through}\`
- Verification (docs build + tests): **${verified ? "passing" : "FAILING — needs a human look"}**
${note ? `- ${note}\n` : ""}${draftReasons.length > 0 ? `- Draft because: ${draftReasons.join("; ")}\n` : ""}
${surfaceBlock ? `${surfaceBlock}\n\n` : ""}### Changes

${section("changes", "| Docs change | Source |", changesRows)}

### Pending — will retry

${section("pending", "| PR | Why |", pendingDisplay)}

### Considered, no docs change needed

${section("skipped", "| PR | Reason |", skippedRows)}

---

(bot) Generated by the docs-sync workflow. Humans review and merge; while this PR stays open, the next daily run appends new changes here. Branch: \`${BRANCH}\`.
<!-- docs-sync: processed-through ${through} -->
${learnedThrough ? learnedThrough + "\n" : ""}`
}

function mergeRows(oldRows, newRows) {
  const seen = new Set()
  const out = []
  for (const row of [...oldRows, ...newRows]) {
    if (seen.has(row)) continue
    seen.add(row)
    out.push(row)
  }
  return out.slice(-ROW_CAP)
}

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"))
  } catch {
    return fallback
  }
}

/**
 * Uncovered = (worthy URLs with no summary row) ∪ (summary action "pending")
 * ∪ (triage entries with pending: true). A worthy PR is covered iff it has a
 * summary row whose action !== "pending" and carries no triage pending flag.
 */
export function computeUncovered({ worthy, summary, triage }) {
  const worthyList = Array.isArray(worthy) ? worthy : []
  const summaryList = Array.isArray(summary) ? summary : []
  const triageList = Array.isArray(triage) ? triage : []

  const summaryByUrl = new Map()
  for (const e of summaryList) {
    if (e?.url) summaryByUrl.set(e.url, e)
  }

  const triagePendingByUrl = new Map()
  for (const e of triageList) {
    if (e?.url && e.pending === true) triagePendingByUrl.set(e.url, e)
  }

  /** @type {Map<string, { url: string, pr?: number, reason: string }>} */
  const out = new Map()

  for (const w of worthyList) {
    const url = w?.url
    if (!url) continue
    const row = summaryByUrl.get(url)
    if (!row) {
      out.set(url, {
        url,
        pr: w.number ?? w.pr,
        reason: "no edit summary row (edit pass did not cover this PR)",
      })
      continue
    }
    if (row.action === "pending") {
      out.set(url, {
        url,
        pr: row.pr ?? w.number ?? w.pr,
        reason: row.reason || "edit pass pending",
      })
    }
  }

  // Summary pending rows for URLs not in worthy (defensive).
  for (const row of summaryList) {
    if (row?.action === "pending" && row.url && !out.has(row.url)) {
      out.set(row.url, {
        url: row.url,
        pr: row.pr,
        reason: row.reason || "edit pass pending",
      })
    }
  }

  for (const [url, e] of triagePendingByUrl) {
    if (out.has(url)) continue
    out.set(url, {
      url,
      pr: e.pr,
      reason: e.reason || "triage pending",
    })
  }

  return [...out.values()]
}

/**
 * processed-through = now when uncovered is empty; otherwise earliest
 * merged_at among uncovered PRs minus 1 ms (from digest-full.json).
 * When uncovered is non-empty but no merged_at resolves, hold at
 * `fallback` (the run's window start / SINCE): every uncovered PR was
 * collected via merged:>=since, so holding there re-collects all of them.
 * Never advance past unresolved uncovered PRs (Defect-B permanent-loss).
 */
export function computeProcessedThrough({ uncovered, digest, now, fallback }) {
  const nowIso = typeof now === "string" ? now : new Date(now).toISOString()
  if (!uncovered || uncovered.length === 0) return nowIso

  const digestList = Array.isArray(digest) ? digest : []
  const byUrl = new Map(digestList.filter((d) => d?.url).map((d) => [d.url, d]))

  let earliest = null
  for (const u of uncovered) {
    const d = byUrl.get(u.url)
    const mergedAt = d?.merged_at
    if (!mergedAt) continue
    const t = Date.parse(mergedAt)
    if (!Number.isFinite(t)) continue
    if (earliest === null || t < earliest) earliest = t
  }

  if (earliest === null) {
    // digest-full missing/corrupt while uncovered is non-empty: hold at
    // window start so collect's merged:>=since re-collects every PR.
    // Never use now−1ms — that strands uncovered PRs permanently.
    const fallbackMs = fallback == null ? NaN : Date.parse(fallback)
    if (!Number.isFinite(fallbackMs)) {
      throw new Error(
        `docs-sync: cannot resolve merged_at for ${uncovered.length} uncovered PR(s) and fallback/SINCE is missing or unparseable; refusing to advance processed-through`,
      )
    }
    const fallbackIso = new Date(fallbackMs).toISOString()
    console.warn(
      `::warning::docs-sync: merge times for ${uncovered.length} uncovered PR(s) could not be resolved; holding watermark at window start ${fallbackIso}`,
    )
    return fallbackIso
  }

  return new Date(earliest - 1).toISOString()
}

/**
 * Content gate: legitimate bot edits are docs pages and nav files. Only
 * those are built and tested during verify (content-integrity.test.ts
 * walks pages/ only), so anything else in the docs package forces human
 * review. LEARNINGS.md is a root-level .md file, like the three sibling
 * .md files already at that level, so it is not built or tested and is
 * safe to exclude from the gate.
 */
export function nonContentFiles(changedFiles) {
  return (Array.isArray(changedFiles) ? changedFiles : []).filter(
    (f) =>
      f !== LEARNINGS_FILE &&
      !f.startsWith("packages/kilo-docs/pages/") &&
      !f.startsWith("packages/kilo-docs/lib/nav/"),
  )
}

/**
 * Route summary + triage into the three body sections.
 * changesRows = action neither skipped nor pending
 * pendingRows = uncovered from computeUncovered
 * skippedRows = action === "skipped" ∪ triage docs_worthy false && !pending
 */
export function routeRows({ summary, triage, uncovered }) {
  const summaryList = Array.isArray(summary) ? summary : []
  const triageList = Array.isArray(triage) ? triage : []
  const uncoveredList = Array.isArray(uncovered) ? uncovered : []

  const changesEntries = summaryList.filter((e) => e.action !== "skipped" && e.action !== "pending")
  const skippedEntries = [
    ...triageList.filter((e) => e.docs_worthy === false && e.pending !== true),
    ...summaryList.filter((e) => e.action === "skipped"),
  ]

  return {
    changesRows: changesEntries.map(changeRow),
    pendingRows: uncoveredList.map(pendingRow),
    skippedRows: skippedEntries.map(skippedRow),
  }
}

/**
 * Drop pre-existing Considered rows whose reason contains any of the three
 * legacy failure literals (substring match — live rows carry longer strings).
 * Genuine no-doc-needed rows are untouched.
 */
export function dropLegacySkipped(rows) {
  const list = Array.isArray(rows) ? rows : []
  const needles = ["edit pass failed or timed out", "triage failed to classify", "not classified by triage"]
  return list.filter((row) => {
    const s = String(row ?? "")
    return !needles.some((n) => s.includes(n))
  })
}

/**
 * Resolve the learned-through marker for renderBody.
 *
 * Order: env LEARNED_THROUGH when set and non-empty; else the marker
 * parsed out of the existing PR body; else "".
 * The fallback is load-bearing: a run where extraction was skipped,
 * failed, or already PATCHed the marker itself must not clobber a good
 * marker.
 */
export function resolveLearnedThrough({ envValue, prBody }) {
  const fromEnv = String(envValue ?? "").trim()
  if (fromEnv) return fromEnv
  const m = String(prBody ?? "").match(/<!--\s*docs-sync:\s*learned-through\s+commit=\S+\s+comment=\S+\s*-->/)
  return m ? m[0] : ""
}

/**
 * No-diff early-return report. Returns summary markdown and an optional
 * replay warning. Warns IFF sinceOverride && uncovered non-empty (no commit
 * happened — that is the caller's situation).
 */
export function noDiffReport({ uncovered, sinceOverride }) {
  const list = Array.isArray(uncovered) ? uncovered : []
  const lines =
    list.length === 0
      ? ["The agent found nothing worth documenting in this window."]
      : [
          `No packages/kilo-docs diff was produced, but ${list.length} PR(s) remain uncovered and will be re-collected on the next scheduled run:`,
          "",
          ...list.map((u) => `- [${u.url}] ${u.reason || "uncovered"}`),
        ]

  const summary = `### docs-sync: no docs changes\n\n${lines.join("\n")}`

  let warning = null
  if (sinceOverride && list.length > 0) {
    warning =
      "docs-sync since-override replay left uncovered PRs and wrote no PR body (no docs commit); re-run the override — the watermark was not held back in the body"
  }

  return { summary, warning }
}

/** PR title for a surface. */
export function prTitle(name, date) {
  return `docs: auto-sync ${name} with merged PRs (through ${date})`
}

/**
 * The per-surface block appended to the rolling body. It states the surface,
 * the derivation and the map file, the source/doc prefixes, the paths that fall
 * to `other`, and how the two reviewers were computed (or why they were not).
 */
export function surfaceBlock({ name, map, reviewers, note }) {
  const other = map?.other?.name ?? OTHER
  const sources = surfaceSourcePrefixes(name, map)
  const docs = surfaceDocPrefixes(name, map)
  const otherPaths = otherDocPrefixes(map)
  const list = (prefixes) => (prefixes.length > 0 ? prefixes.map((p) => `\`${p}\``).join(", ") : "_none_")
  const pair = reviewers.length > 0 ? reviewers.map((r) => `@${r}`).join(" and ") : "_none computed_"
  return [
    `### Surface: \`${name}\``,
    "",
    `- Assignees / requested reviewers: ${pair}`,
    `- Derivation: ${derivation(map)}`,
    `- Map: \`${MAP_FILE}\``,
    `- Source prefixes: ${list(sources)}`,
    `- Doc prefixes: ${list(docs)}`,
    `- Paths that fall to \`${other}\`: ${list(otherPaths)}`,
    `- How the two were computed: ${note}`,
  ].join("\n")
}

/**
 * Open auto-docs PRs keyed by surface name. Only `docs/auto-sync/<surface>`
 * heads are considered; the legacy `docs/auto-sync` head is not a surface PR.
 */
async function openSurfacePrs({ api, searchIssues, repo, names }) {
  const prs = await searchIssues(`repo:${repo} is:pr is:open label:auto-docs`, { maxPages: 2 })
  const byName = new Map()
  for (const item of prs) {
    let detail
    try {
      detail = await api(`/repos/${repo}/pulls/${item.number}`)
    } catch (err) {
      console.warn(`::warning::docs-sync: could not read auto-docs PR #${item.number}: ${err.message}`)
      continue
    }
    const ref = String(detail?.head?.ref ?? "")
    for (const name of names) {
      if (ref === surfaceBranch(name)) byName.set(name, detail)
    }
  }
  return byName
}

/**
 * Split a surface's changed files by whether they still exist at
 * `integrationSha`. A path deleted in the integration tree has no blob there,
 * so `git checkout integrationSha -- <path>` fails with `pathspec ... did not
 * match any file(s) known to git`, and checkout can only restore paths, never
 * remove one. Deletions must be removed from the worktree instead.
 */
function partitionByPresence(git, sha, files) {
  if (files.length === 0) return { present: [], removed: [] }
  const names = new Set(git(["ls-tree", "-r", "--name-only", sha, "--", ...files]).split("\n").filter(Boolean))
  return { present: files.filter((f) => names.has(f)), removed: files.filter((f) => !names.has(f)) }
}

/**
 * Build the surface branch in a throwaway worktree and push it. On update the
 * base is the open PR's remote branch (so human commits survive), merged with
 * origin/main; otherwise it is a fresh branch from origin/main.
 */
function buildSurfaceBranch({ name, files, branch, integrationSha, update, date }) {
  try {
    git(["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
  } catch {
    // Branch may not exist yet; --force-with-lease will create it.
  }
  const base = update ? `origin/${branch}` : "origin/main"
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-sync-wt-"))
  try {
    git(["worktree", "add", "--detach", tmp, base])
    if (update) {
      // Preserve human commits on the open PR branch.
      git(["merge", "origin/main", "--no-edit"], tmp)
    }
    // Remove deletions before restoring the rest, so a file→directory change
    // cannot block the checkout of a path under the removed file.
    const { present, removed } = partitionByPresence(git, integrationSha, files)
    if (removed.length > 0) git(["rm", "-rf", "--ignore-unmatch", "--", ...removed], tmp)
    if (present.length > 0) {
      git(["checkout", integrationSha, "--", ...present], tmp)
      git(["add", "--", ...present], tmp)
    }
    const dirty = git(["status", "--porcelain"], tmp)
    if (dirty !== "") {
      git(["commit", "-m", `docs: sync ${name} with merged PRs (${date})`], tmp)
    } else {
      console.log(`surface ${name}: no file delta over ${base}; refreshing PR body only`)
    }
    git(
      update
        ? ["push", "origin", `HEAD:refs/heads/${branch}`]
        : ["push", "--force-with-lease", "origin", `HEAD:refs/heads/${branch}`],
      tmp,
    )
  } finally {
    try {
      git(["worktree", "remove", "--force", tmp])
    } catch (err) {
      console.warn(`::warning::docs-sync: could not remove worktree ${tmp}: ${err.message}`)
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch (err) {
      console.warn(`::warning::docs-sync: could not delete worktree dir ${tmp}: ${err.message}`)
    }
    try {
      git(["worktree", "prune"])
    } catch (err) {
      console.warn(`::warning::docs-sync: could not prune worktrees: ${err.message}`)
    }
  }
}

/** Create or update one surface PR. Throws on failure; the caller isolates it. */
async function upsertSurface({
  name,
  files,
  map,
  api,
  repo,
  now,
  date,
  since,
  through,
  verified,
  rows,
  openPr,
  integrationSha,
}) {
  const branch = surfaceBranch(name)
  const reviewed = await computeSurfaceReviewers(name, { api, repo, now, map })

  const draftReasons = []
  if (files.length > FILE_CAP) draftReasons.push(`diff exceeds ${FILE_CAP} files (${files.length})`)
  if (!verified) draftReasons.push("docs build/tests not passing")
  const nonContent = nonContentFiles(files)
  if (nonContent.length > 0) {
    const listed = nonContent
      .slice(0, 5)
      .map((f) => clean(f).replaceAll("|", "\\|"))
      .join(", ")
    draftReasons.push(`touches non-content files outside pages/ and lib/nav/: ${listed}`)
  }
  const draft = draftReasons.length > 0

  const update = Boolean(openPr)
  buildSurfaceBranch({ name, files, branch, integrationSha, update, date })

  // Append-only: carry rows already on the surface PR body forward.
  let oldChanges = []
  let oldSkipped = []
  let prBody = ""
  if (update) {
    prBody = openPr.body ?? ""
    oldChanges = extractSectionRows(prBody, "changes")
    oldSkipped = dropLegacySkipped(extractSectionRows(prBody, "skipped"))
  }
  const learnedThrough = resolveLearnedThrough({ envValue: process.env.LEARNED_THROUGH, prBody })

  const body = renderBody({
    date,
    since,
    through,
    learnedThrough,
    changesRows: mergeRows(oldChanges, rows.changesRows),
    pendingRows: rows.pendingRows,
    skippedRows: mergeRows(oldSkipped, rows.skippedRows),
    verified,
    draftReasons,
    note: "",
    surfaceBlock: surfaceBlock({ name, map, reviewers: reviewed.reviewers, note: reviewed.note }),
  })
  console.log(`--- ${name} PR body ---\n${body}\n--- end ${name} PR body ---`)

  let pr
  if (update) {
    pr = await api(`/repos/${repo}/pulls/${openPr.number}`, {
      method: "PATCH",
      body: { title: prTitle(name, date), body },
    })
  } else {
    pr = await api(`/repos/${repo}/pulls`, {
      method: "POST",
      body: { title: prTitle(name, date), head: branch, base: "main", body, draft },
    })
    await api(`/repos/${repo}/issues/${pr.number}/labels`, { method: "POST", body: { labels: ["auto-docs"] } })
  }
  // Best effort: the PR already exists here, so a non-collaborator, an author
  // login, or a revoked account must not fail the surface.
  if (reviewed.reviewers.length > 0) {
    try {
      await api(`/repos/${repo}/issues/${pr.number}/assignees`, {
        method: "POST",
        body: { assignees: reviewed.reviewers },
      })
      await api(`/repos/${repo}/pulls/${pr.number}/requested_reviewers`, {
        method: "POST",
        body: { reviewers: reviewed.reviewers },
      })
    } catch (err) {
      console.warn(`::warning::docs-sync: could not assign or request review for ${name}: ${err.message}`)
    }
  }

  return {
    name,
    url: pr.html_url,
    number: pr.number,
    branch,
    reviewers: reviewed.reviewers,
    draft,
    created: !update,
  }
}

async function main() {
  const { api, appendOutput, appendSummary, repo, searchIssues } = await import("./lib.mjs")

  const now = process.env.PROCESSED_THROUGH ?? new Date().toISOString()
  const since = process.env.SINCE ?? "unknown"
  const sinceOverride = process.env.SINCE_OVERRIDE === "true"
  const mode = ["update", "conflict"].includes(process.env.PREP_MODE) ? process.env.PREP_MODE : "fresh"
  const verified = process.env.VERIFIED === "true"
  const date = now.slice(0, 10)

  // The surface map is data, loaded once for the whole run.
  const map = loadSurfaceMap()

  // The agent's run summary is consumed here and never committed.
  const agentSummary = readJson(SUMMARY_FILE, [])
  fs.rmSync(SUMMARY_FILE, { force: true })
  const triage = readJson("docs-sync-out/triage.json", [])
  const worthy = readJson("docs-sync-out/worthy.json", [])
  const digest = readJson("docs-sync-out/digest-full.json", [])

  // Order matters: compute uncovered BEFORE the no-diff early return so
  // noDiffReport can name every held-back PR.
  const uncovered = computeUncovered({ worthy, summary: agentSummary, triage })

  if (git(["status", "--porcelain", "--", DOCS_PATH]) === "") {
    console.log("no packages/kilo-docs changes produced; nothing to commit")
    const { summary, warning } = noDiffReport({ uncovered, sinceOverride })
    appendSummary(summary)
    if (warning) console.warn(`::warning::${warning}`)
    return
  }

  // Git identity is configured once in docs-sync.yml (Configure git identity)
  // before any commit-creating step, including prepare-branch's merge.
  git(["add", DOCS_PATH])
  git(["commit", "-m", `docs: sync with merged PRs (${date})`])
  const integrationSha = git(["rev-parse", "HEAD"])

  // Watermark: now when fully covered; else earliest uncovered merged_at − 1ms.
  // Pass SINCE as fallback so missing digest-full cannot strand uncovered PRs.
  // Computed once (global); per-surface failures never touch it.
  const through = computeProcessedThrough({ uncovered, digest, now, fallback: since })

  // Commit the full diff to the integration branch and push it first, so a
  // single surface's later failure cannot lose the run's changes. A conflicted
  // run pushes its dated fallback branch; a normal run pushes the durability
  // ref (see INTEGRATION_BRANCH).
  const changedFiles = git(["diff", "--name-only", "origin/main...HEAD", "--", DOCS_PATH]).split("\n").filter(Boolean)
  const durableBranch = mode === "conflict" ? BRANCH : INTEGRATION_BRANCH
  git(
    mode === "update"
      ? ["push", "origin", `HEAD:refs/heads/${durableBranch}`]
      : ["push", "--force-with-lease", "origin", `HEAD:refs/heads/${durableBranch}`],
  )

  try {
    await api(`/repos/${repo()}/labels`, {
      method: "POST",
      body: { name: "auto-docs", color: "1d76db", description: "Automated docs-sync PRs" },
    })
  } catch (err) {
    if (err.status !== 422) throw err // 422 = label already exists
  }

  const rows = routeRows({ summary: agentSummary, triage, uncovered })
  const groups = groupBySurface(changedFiles, map)

  // Run-log proof: the computed surface for every changed file.
  console.log(`docs-sync surface map (${changedFiles.length} changed files):`)
  for (const file of changedFiles) console.log(`  ${surfaceForDoc(file, map)} <- ${file}`)

  let open = new Map()
  try {
    open = await openSurfacePrs({ api, searchIssues, repo: repo(), names: surfaceNames(map) })
  } catch (err) {
    console.warn(`::warning::docs-sync: could not list open surface PRs; creating fresh branches: ${err.message}`)
  }

  const results = []
  for (const name of surfaceNames(map)) {
    const files = groups.get(name)
    if (!files || files.length === 0) continue
    try {
      const result = await upsertSurface({
        name,
        files,
        map,
        api,
        repo: repo(),
        now,
        date,
        since,
        through,
        verified,
        rows,
        openPr: open.get(name) ?? null,
        integrationSha,
      })
      results.push(result)
      console.log(`surface ${name}: ${result.created ? "created" : "updated"} ${result.url} reviewers=${result.reviewers.join(",") || "none"}`)
    } catch (err) {
      results.push({ name, error: err })
      console.warn(`::warning::docs-sync: surface ${name} failed: ${err.message}`)
    }
  }

  const summaryLines = ["### docs-sync surface PRs", ""]
  for (const r of results) {
    summaryLines.push(r.error ? `- **${r.name}**: failed — ${clean(r.error.message)}` : `- **${r.name}**: ${r.url}`)
  }
  summaryLines.push("", `- changed files: ${changedFiles.length}`)
  summaryLines.push(`- uncovered: ${uncovered.length}`)
  summaryLines.push(`- processed-through: ${through}`)
  appendSummary(summaryLines.join("\n"))

  const prUrl = results.find((r) => r.url)?.url ?? ""
  if (prUrl) appendOutput("pr_url", prUrl)
  const failures = results.filter((r) => r.error).length
  console.log(
    `docs-sync: ${results.length - failures} surface PR(s), ${failures} failure(s), files=${changedFiles.length}, uncovered=${uncovered.length}, through=${through}`,
  )
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
