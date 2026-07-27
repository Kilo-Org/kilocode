// kilocode_change - new file

/**
 * Shared helpers for the docs-sync bot scripts. Dependency-free (Node 20+
 * global fetch) so the workflow does not rely on runner images shipping the
 * gh CLI.
 */

import fs from "node:fs"

const API = "https://api.github.com"
const MAX_RETRIES = 3

export function token() {
  const t = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!t) throw new Error("GH_TOKEN (or GITHUB_TOKEN) is required")
  return t
}

export function repo() {
  const r = process.env.GITHUB_REPOSITORY
  if (!r) throw new Error("GITHUB_REPOSITORY is required")
  return r
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function api(path, { method = "GET", body } = {}) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token()}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "kilo-docs-sync-bot",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.warn(`network error (${err.message}), retrying in ${5 * attempt}s`)
        await sleep(5000 * attempt)
        continue
      }
      throw err
    }

    if (res.status === 403) {
      const text = await res.text()
      if (text.includes("rate limit") && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after")) || 30
        console.warn(`rate limited, retrying in ${retryAfter}s`)
        await sleep(retryAfter * 1000)
        continue
      }
      const err = new Error(`${method} ${path} -> 403: ${text}`)
      err.status = 403
      throw err
    }

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      console.warn(`${method} ${path} -> ${res.status}, retrying in ${5 * attempt}s`)
      await sleep(5000 * attempt)
      continue
    }

    if (!res.ok) {
      const text = await res.text()
      const err = new Error(`${method} ${path} -> ${res.status}: ${text}`)
      err.status = res.status
      throw err
    }

    if (res.status === 204) return null
    return res.json()
  }
  throw new Error(`${method} ${path}: exhausted retries`)
}

/** Paginated search/issues. Caps at `maxPages` * 100 results. */
export async function searchIssues(query, { maxPages = 5 } = {}) {
  const items = []
  for (let page = 1; page <= maxPages; page++) {
    const data = await api(`/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`)
    items.push(...(data.items ?? []))
    if ((data.items ?? []).length < 100) break
  }
  return items
}

export async function listPrFiles(fullRepo, number, { maxPages = 3 } = {}) {
  const files = []
  for (let page = 1; page <= maxPages; page++) {
    const batch = await api(`/repos/${fullRepo}/pulls/${number}/files?per_page=100&page=${page}`)
    files.push(...batch)
    if (batch.length < 100) break
  }
  return files
}

export function appendOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT
  if (out) fs.appendFileSync(out, `${name}=${value}\n`)
  console.log(`output ${name}=${value}`)
}

export function appendSummary(markdown) {
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) fs.appendFileSync(summary, markdown + "\n")
}
