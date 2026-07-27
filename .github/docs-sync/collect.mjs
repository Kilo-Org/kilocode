// kilocode_change - new file

/**
 * Collects PRs merged to the source repos since the watermark, applies a
 * deterministic pre-filter, and writes docs-sync-out/digest.json for the LLM
 * triage pass.
 *
 * Pre-filter drops (triage never sees these):
 *   - PRs labeled auto-docs (this bot's own rolling PRs)
 *   - chore/test/ci/build/docs/style/refactor/revert conventional titles
 *   - PRs touching only docs/non-product paths
 *
 * Bot-authored PRs are kept: release/dependency bots ship user-facing
 * changes too, and the label + docs-only guards above prevent loops.
 */

import fs from "node:fs"
import { api, appendOutput, appendSummary, listPrFiles, searchIssues } from "./lib.mjs"

const SOURCE_REPOS = ["Kilo-Org/cloud", "Kilo-Org/kilocode"]
const OUT_DIR = "docs-sync-out"
const BODY_LIMIT = 2000
const SLIM_BODY_LIMIT = 300
const PATCH_LIMIT = 8000
const FILE_LIMIT = 30
const DROP_TITLE = /^(chore|test|ci|build|docs|style|refactor|revert)(\(.+\))?!?:/i
const DOCS_ONLY_PATH = /^(packages\/kilo-docs\/|\.github\/docs-sync\/|docs-sync-out\/|docs\/|[^/]+\.md$)/

function argSince() {
  const i = process.argv.indexOf("--since")
  const v = i >= 0 ? process.argv[i + 1] : null
  if (!v || Number.isNaN(new Date(v).getTime())) {
    throw new Error("usage: collect.mjs --since <ISO date>")
  }
  return new Date(v)
}

async function mergedPrs(fullRepo, since) {
  const query = `repo:${fullRepo} is:pr is:merged merged:>=${since.toISOString()}`
  return searchIssues(query)
}

const since = argSince()
console.log(`collecting PRs merged since ${since.toISOString()}`)

const digest = []
const dropped = { label: 0, title: 0, docs_only: 0, fetch_error: 0 }

for (const fullRepo of SOURCE_REPOS) {
  const prs = await mergedPrs(fullRepo, since)
  console.log(`${fullRepo}: ${prs.length} merged PRs in window`)

  for (const item of prs) {
    const author = item.user?.login ?? ""
    if ((item.labels ?? []).some((l) => l.name === "auto-docs")) {
      dropped.label++
      continue
    }
    if (DROP_TITLE.test(item.title ?? "")) {
      dropped.title++
      continue
    }

    const number = item.number
    let pr
    let files
    try {
      pr = await api(`/repos/${fullRepo}/pulls/${number}`)
      files = await listPrFiles(fullRepo, number)
    } catch (err) {
      // Isolate per-PR failures: one dead PR must not abort the whole run.
      console.warn(`::warning::skipping ${fullRepo}#${number}: ${err.message}`)
      dropped.fetch_error++
      continue
    }
    // listPrFiles caps at 300 files; a truncated list can't support the
    // docs-only classification, so keep such PRs and record the true total.
    const truncated = files.length >= 300
    if (!truncated && files.length > 0 && files.every((f) => DOCS_ONLY_PATH.test(f.filename))) {
      dropped.docs_only++
      continue
    }

    let patch = ""
    for (const f of files) {
      if (!f.patch) continue
      const chunk = `--- ${f.filename}\n${f.patch}\n`
      if (patch.length + chunk.length > PATCH_LIMIT) {
        patch += "\n... (diff truncated) ...\n"
        break
      }
      patch += chunk
    }

    digest.push({
      repo: fullRepo,
      number,
      title: pr.title,
      url: pr.html_url,
      author,
      merged_at: pr.merged_at,
      labels: (pr.labels ?? []).map((l) => l.name),
      body: (pr.body ?? "").slice(0, BODY_LIMIT),
      files: files.slice(0, FILE_LIMIT).map((f) => `${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`),
      files_total: pr.changed_files ?? files.length,
      patch_excerpt: patch,
    })
  }
}

digest.sort((a, b) => new Date(a.merged_at) - new Date(b.merged_at))

fs.mkdirSync(OUT_DIR, { recursive: true })
// Full digest (bodies + patch excerpts) is filtered down to docs-worthy PRs
// for the edit pass; the slim digest keeps the triage pass context small.
fs.writeFileSync(`${OUT_DIR}/digest-full.json`, JSON.stringify(digest, null, 2))
const slim = digest.map(({ patch_excerpt, body, ...rest }) => ({
  ...rest,
  body: body.slice(0, SLIM_BODY_LIMIT),
}))
fs.writeFileSync(`${OUT_DIR}/digest.json`, JSON.stringify(slim, null, 2))

console.log(`kept ${digest.length} PRs, dropped:`, dropped)
appendOutput("count", digest.length)
appendOutput("digest", `${OUT_DIR}/digest.json`)

appendSummary(
  [
    "### docs-sync collect",
    "",
    `- window: since \`${since.toISOString()}\``,
    `- kept: **${digest.length}** PRs`,
    `- dropped: ${dropped.label} auto-docs, ${dropped.title} title filter, ${dropped.docs_only} docs-only, ${dropped.fetch_error} fetch errors`,
    "",
    ...digest.map((d) => `- [${d.repo}#${d.number}](${d.url}) ${d.title}`),
  ].join("\n"),
)
