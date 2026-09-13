// kilocode_change - new file

/**
 * Reviewer ranking for the docs-sync surface PRs.
 *
 * `rankContributors` is pure: it turns commit metadata into a recency-weighted
 * leaderboard. `computeSurfaceReviewers` is the side-effecting wrapper that
 * reads the committed surface map, asks the GitHub API for commits touching a
 * surface's source prefixes, then asks for the top candidates' permission until
 * two people with write access are found. Both are dependency-free so the
 * workflow needs no extra package.
 */

import { SURFACE_MAP_PATH, OTHER, loadSurfaceMap, surfaceReviewers, surfaceSourcePrefixes } from "./surfaces.mjs"

const BOT_LOGIN = /\[bot\]$/i
const DAY_MS = 86_400_000
const DEFAULT_HALF_LIFE_DAYS = 180
// Any of GitHub's write-capable repository permission levels.
const WRITE_PERMISSIONS = ["admin", "write", "maintain"]

function paths(prefixes) {
  return prefixes.map((p) => `\`${p}\``).join(", ")
}

/**
 * Recency-weighted contributor leaderboard.
 *
 * `commits` is `[{ login, type, date }]`. Each commit contributes
 * `0.5 ** (ageDays / halfLifeDays)` to its author's score, so a commit one
 * half-life old counts half as much as one today. Bots (author `type === "Bot"`
 * or a login ending in `[bot]`) are skipped. Sorted by score desc, then login.
 */
export function rankContributors(commits, now, { halfLifeDays = DEFAULT_HALF_LIFE_DAYS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now)
  const half = halfLifeDays > 0 ? halfLifeDays : DEFAULT_HALF_LIFE_DAYS
  const totals = new Map()

  for (const commit of Array.isArray(commits) ? commits : []) {
    const login = commit?.login
    if (!login) continue
    if (commit?.type === "Bot") continue
    if (BOT_LOGIN.test(login)) continue
    const at = Date.parse(commit?.date)
    if (!Number.isFinite(at) || !Number.isFinite(nowMs)) continue
    const ageDays = Math.max(0, (nowMs - at) / DAY_MS)
    const entry = totals.get(login) ?? { login, score: 0, count: 0 }
    entry.score += 0.5 ** (ageDays / half)
    entry.count += 1
    totals.set(login, entry)
  }

  return [...totals.values()].sort((a, b) => b.score - a.score || a.login.localeCompare(b.login))
}

/**
 * The two reviewers for a surface.
 *
 * `other` has no source paths, so it returns the fixed pair configured in the
 * map without touching the API. Every other surface is ranked from the git
 * history of its source prefixes; candidates are walked in rank order and the
 * first two with admin/write/maintain permission win. On a missing token, a
 * missing repo, or any API failure it returns no reviewers and a `note` naming
 * the reason so the caller can print it in the PR body instead of guessing.
 */
export async function computeSurfaceReviewers(surface, { api, repo, now, map } = {}) {
  const m = map ?? loadSurfaceMap()
  const otherName = m?.other?.name ?? OTHER

  if (surface === otherName || surface === OTHER) {
    const reviewers = surfaceReviewers(otherName, m)
    return {
      reviewers: [...reviewers],
      note: `\`${otherName}\` has no source paths to rank, so it keeps the fixed reviewers ${reviewers
        .map((r) => `@${r}`)
        .join(" and ")} from surfaces.json.`,
      sourcePrefixes: [],
    }
  }

  const prefixes = surfaceSourcePrefixes(surface, m)
  if (prefixes.length === 0) {
    return {
      reviewers: [],
      note: `no source prefixes are configured for surface \`${surface}\` in ${SURFACE_MAP_PATH}.`,
      sourcePrefixes: [],
    }
  }
  if (!repo) {
    return {
      reviewers: [],
      note: `GITHUB_REPOSITORY is missing, so reviewers for \`${surface}\` could not be ranked (paths: ${paths(prefixes)}).`,
      sourcePrefixes: prefixes,
    }
  }
  if (typeof api !== "function") {
    return {
      reviewers: [],
      note: `no GitHub API client was supplied, so reviewers for \`${surface}\` could not be ranked (paths: ${paths(prefixes)}).`,
      sourcePrefixes: prefixes,
    }
  }

  try {
    const commits = []
    for (const prefix of prefixes) {
      const batch = await api(`/repos/${repo}/commits?path=${encodeURIComponent(prefix)}&per_page=100`)
      for (const commit of Array.isArray(batch) ? batch : []) {
        commits.push({ login: commit?.author?.login, type: commit?.author?.type, date: commit?.commit?.author?.date })
      }
    }

    const ranked = rankContributors(commits, now ?? Date.now())
    const reviewers = []
    for (const candidate of ranked) {
      if (reviewers.length >= 2) break
      let level
      try {
        const perm = await api(`/repos/${repo}/collaborators/${candidate.login}/permission`)
        level = perm?.permission ?? perm?.role_name
      } catch (err) {
        // 404 = not a collaborator; skip and try the next candidate.
        if (err?.status === 404) continue
        throw err
      }
      if (WRITE_PERMISSIONS.includes(level)) reviewers.push(candidate.login)
    }

    return {
      reviewers,
      note: `Reviewers for \`${surface}\` are ranked from git history over ${paths(prefixes)} (a commit ${DEFAULT_HALF_LIFE_DAYS} days old counts half as much, half-life ${DEFAULT_HALF_LIFE_DAYS} days). Bots (author type "Bot" or a login matching /\\[bot\\]$/i) and people without admin, write, or maintain permission are excluded.`,
      sourcePrefixes: prefixes,
    }
  } catch (err) {
    return {
      reviewers: [],
      note: `could not rank reviewers for \`${surface}\` over ${paths(prefixes)}: ${err?.message ?? err}`,
      sourcePrefixes: prefixes,
    }
  }
}
