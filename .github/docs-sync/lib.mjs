// kilocode_change - new file

/**
 * Shared helpers for the docs-sync bot scripts. Dependency-free (Node 20+
 * global fetch) so the workflow does not rely on runner images shipping the
 * gh CLI.
 */

import { spawnSync } from "node:child_process"
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

/**
 * Absolute deadline timestamp (ms since epoch) for a wall-clock budget.
 * Used by triage/edit to stop before the job timeout rather than silently
 * truncating.
 */
export function deadline(minutes) {
  return Date.now() + Number(minutes) * 60 * 1000
}

/** Remaining milliseconds until a deadline; never negative. */
export function remainingMs(deadlineMs) {
  return Math.max(0, Number(deadlineMs) - Date.now())
}

/**
 * Backoff schedule between kilo-run attempts. Production waits 60s then 300s
 * (observed outage lasted ~11 min; batch 8 recovered on attempt 2). When
 * DOCS_SYNC_BACKOFF_MS is set it replaces EVERY wait (`0` disables waiting);
 * the workflow never sets it — only selftests do.
 */
export function backoffMsForAttempt(attempt) {
  // attempt is 1-based; wait happens after attempt N before attempt N+1.
  const override = process.env.DOCS_SYNC_BACKOFF_MS
  if (override !== undefined && override !== "") {
    const n = Number(override)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  // After attempt 1 → 60s; after attempt 2 → 300s; nothing after the last.
  if (attempt === 1) return 60_000
  if (attempt === 2) return 300_000
  return 0
}

/**
 * Blocking sleep used between kilo-run retries. Prefer this over async sleep
 * so edit/triage stay synchronous around spawnSync.
 */
export function sleepSync(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return
  const end = Date.now() + n
  // Atomics.wait is the portable Node sync sleep (no busy loop).
  const sab = new SharedArrayBuffer(4)
  const view = new Int32Array(sab)
  while (Date.now() < end) {
    const left = end - Date.now()
    if (left <= 0) break
    Atomics.wait(view, 0, 0, Math.min(left, 2_147_483_647))
  }
}

const STDERR_TAIL_LINES = 20
const STDERR_TAIL_CHARS = 4_000

function tailText(text, { lines = STDERR_TAIL_LINES, chars = STDERR_TAIL_CHARS } = {}) {
  const s = String(text ?? "").trim()
  if (!s) return ""
  const lastLines = s.split("\n").slice(-lines).join("\n")
  return lastLines.length > chars ? lastLines.slice(-chars) : lastLines
}

/**
 * Run `kilo` via spawnSync so stderr is always recoverable — including when
 * the child exits 0 after writing a diagnostic (execFileSync cannot return
 * piped stderr on exit 0; that path lost every diagnostic on run 30122603016).
 *
 * streamStdout:true → inherit fd 1 (edit live log); false → capture stdout
 * (triage parses it). stderr is always buffered.
 */
export function runKilo({ args, timeoutMs, streamStdout = false, label = "kilo" }) {
  const result = spawnSync("kilo", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    stdio: ["ignore", streamStdout ? "inherit" : "pipe", "pipe"],
  })

  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT")
  const exitCode =
    typeof result.status === "number" ? result.status : timedOut ? null : result.status === null ? null : result.status
  const stderrTail = tailText(result.stderr)
  const stdout = streamStdout ? "" : String(result.stdout ?? "")
  // ok is "process finished without OS-level failure". Callers still treat a
  // missing summary / unparseable output as failure even when ok is true —
  // exit 0 is not success for the docs-sync bot.
  const ok = !result.error && result.status === 0

  if (result.error && !timedOut) {
    console.warn(`${label}: spawn error: ${result.error.message}`)
  }

  return { ok, stdout, stderrTail, exitCode, timedOut }
}
