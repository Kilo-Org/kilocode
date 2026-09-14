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

import {
  SURFACE_MAP_PATH,
  OTHER,
  loadSurfaceMap,
  surfaceReviewers,
  surfaceSourceEntries,
  surfaceSourceRepos,
} from "./surfaces.mjs"

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
 * history of its source entries; an entry may name another repository (the
 * cloud repo), in which case its history is read with the `cloudToken`. The
 * commits each candidate authored are tagged with the repository they came
 * from so the permission check asks that same repository.
 *
 * Candidates are walked in rank order and the first two with
 * admin/write/maintain permission win. On a missing token, a missing repo, or
 * any API failure a local surface returns no reviewers and a `note` naming the
 * reason. A surface with a cloud entry instead falls back to the fixed `other`
 * pair (`fallback: true`) and never throws, so its PR is still created.
 */
export async function computeSurfaceReviewers(
  surface,
  { api, repo, now, map, cloudToken = process.env.CLOUD_REPO_TOKEN } = {},
) {
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

  const entries = surfaceSourceEntries(surface, m)
  const prefixes = entries.map((e) => e.prefix)
  if (entries.length === 0) {
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

  // A cloud entry names a repository this job does not own; its history is only
  // reachable with a token that grants `contents: read`.
  const cloudRepos = surfaceSourceRepos(surface, m).filter((r) => r !== repo)
  const fallback = surfaceReviewers(otherName, m)
  const listRepos = (repos) => repos.map((r) => `\`${r}\``).join(", ")

  try {
    if (cloudRepos.length > 0 && !cloudToken) {
      const err = new Error(
        `a token with contents: read on ${cloudRepos.join(", ")} is required (repository secret CROSS_REPO_ACCESS_TOKEN, exposed as CLOUD_REPO_TOKEN)`,
      )
      err.code = "CLOUD_TOKEN_REQUIRED"
      throw err
    }

    const commits = []
    // `rankContributors` is pure and returns only `{ login, score, count }`, so
    // remember where each author's commits came from for the permission check.
    const origin = new Map()
    for (const entry of entries) {
      const remote = Boolean(entry.repo && entry.repo !== repo)
      const target = entry.repo ?? repo
      const auth = remote ? cloudToken : undefined
      const batch = await api(
        `/repos/${target}/commits?path=${encodeURIComponent(entry.prefix)}&per_page=100`,
        auth === undefined ? {} : { auth },
      )
      for (const commit of Array.isArray(batch) ? batch : []) {
        const login = commit?.author?.login
        const date = commit?.commit?.author?.date
        commits.push({ login, type: commit?.author?.type, date, repo: target, auth })
        if (!login) continue
        const seen = origin.get(login)
        if (!seen || Date.parse(date) > Date.parse(seen.date)) origin.set(login, { repo: target, auth, date })
      }
    }

    const ranked = rankContributors(commits, now ?? Date.now())
    const reviewers = []
    for (const candidate of ranked) {
      if (reviewers.length >= 2) break
      const meta = origin.get(candidate.login) ?? {}
      let level
      try {
        const perm = await api(
          `/repos/${meta.repo ?? repo}/collaborators/${candidate.login}/permission`,
          meta.auth === undefined ? {} : { auth: meta.auth },
        )
        level = perm?.permission ?? perm?.role_name
      } catch (err) {
        // 404 = not a collaborator; skip and try the next candidate.
        if (err?.status === 404) continue
        throw err
      }
      if (WRITE_PERMISSIONS.includes(level)) reviewers.push(candidate.login)
    }

    const from = cloudRepos.length > 0 ? `${listRepos(cloudRepos)} git history` : "git history"
    return {
      reviewers,
      note: `Reviewers for \`${surface}\` are ranked from ${from} over ${paths(prefixes)} (a commit ${DEFAULT_HALF_LIFE_DAYS} days old counts half as much, half-life ${DEFAULT_HALF_LIFE_DAYS} days). Bots (author type "Bot" or a login matching /\\[bot\\]$/i) and people without admin, write, or maintain permission are excluded.`,
      sourcePrefixes: prefixes,
    }
  } catch (err) {
    if (cloudRepos.length === 0) {
      return {
        reviewers: [],
        note: `could not rank reviewers for \`${surface}\` over ${paths(prefixes)}: ${err?.message ?? err}`,
        sourcePrefixes: prefixes,
      }
    }
    return {
      reviewers: [...fallback],
      fallback: true,
      note: `could not rank reviewers for \`${surface}\` from ${listRepos(cloudRepos)} over ${paths(prefixes)}: ${err?.message ?? err}. Fell back to the fixed \`${otherName}\` reviewers ${fallback
        .map((r) => `@${r}`)
        .join(
          " and ",
        )}; set repository secret CROSS_REPO_ACCESS_TOKEN (exposed as CLOUD_REPO_TOKEN) with contents: read on ${cloudRepos.join(", ")}.`,
      sourcePrefixes: prefixes,
    }
  }
}
