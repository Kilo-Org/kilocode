// kilocode_change - new file

/**
 * Shared helpers for the docs-sync bot scripts. Dependency-free (Node 20+
 * global fetch) so the workflow does not rely on runner images shipping the
 * gh CLI.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"

// Test hook: DOCS_SYNC_API_BASE points the API at a local stub server. The workflow
// never sets it — only selftests do.
const API = process.env.DOCS_SYNC_API_BASE || "https://api.github.com"
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

// CSI sequences (colour, cursor moves, erases). kilo renders its TUI to stderr,
// so an unstripped tail lands in the rolling PR's pending table as
// "^[[0m→ ^[[0mRead packages/..." and the cause is unreadable. Stripped before
// the line/char slice so escapes do not eat the budget. The persisted
// docs-sync-out/kilo-stderr-*.log stays raw — that is the debugging record.
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

function tailText(text, { lines = STDERR_TAIL_LINES, chars = STDERR_TAIL_CHARS } = {}) {
  const s = String(text ?? "")
    .replace(ANSI_CSI, "")
    .trim()
  if (!s) return ""
  const lastLines = s.split("\n").slice(-lines).join("\n")
  return lastLines.length > chars ? lastLines.slice(-chars) : lastLines
}

/**
 * Artifact files are raw: GitHub masks secret values in log streams only, and the runner
 * env holds long-lived secrets (KILO_API_KEY), so exact values of secret-looking env vars
 * are redacted before stdout/stderr is persisted or printed.
 * Matching is exact-substring and case-sensitive on values — JSON-escaped, base64'd, or
 * line-wrapped renderings and values shorter than 8 chars survive (same limitation as
 * GitHub's own log masking); this is defense-in-depth, not a guarantee the logs are clean.
 */
export function redactEnvSecrets(text) {
  let out = String(text ?? "")
  // Also match CREDENTIAL/PASSWORD/ORG_ID/_PAT (e.g. KILO_ORG_ID, GH_PAT) beyond KEY|TOKEN|SECRET.
  const nameRe = /KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|ORG_ID|_PAT$/i
  const candidates = []
  for (const [name, value] of Object.entries(process.env)) {
    if (!nameRe.test(name)) continue
    if (typeof value !== "string" || value.length < 8) continue
    candidates.push(value)
  }
  // Longer values first so a shorter secret that is a prefix of a longer one cannot leave a remainder.
  candidates.sort((a, b) => b.length - a.length)
  for (const value of candidates) {
    if (!out.includes(value)) continue
    out = out.split(value).join("***")
  }
  return out
}

/** Max bytes of child stderr persisted to docs-sync-out/ (full buffer, not the console tail). */
const STDERR_LOG_MAX_CHARS = 8 * 1024 * 1024

/**
 * Run `kilo` via spawnSync so stderr is always recoverable — including when
 * the child exits 0 after writing a diagnostic (execFileSync cannot return
 * piped stderr on exit 0; that path lost every diagnostic on run 30122603016).
 *
 * streamStdout:true → inherit fd 1 (edit live log); false → capture stdout
 * (triage parses it). stderr is always buffered.
 *
 * Always writes the full captured stderr to
 * docs-sync-out/kilo-stderr-<sanitized-label>.log (unconditional — success and
 * failure). The console return value still uses the short tailText.
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
  const stderrRaw = String(result.stderr ?? "")
  const stderrSafe = redactEnvSecrets(stderrRaw)
  const stderrTail = tailText(stderrSafe)
  const stdoutSafe = streamStdout ? "" : redactEnvSecrets(String(result.stdout ?? ""))
  // ok is "process finished without OS-level failure". Callers still treat a
  // missing summary / unparseable output as failure even when ok is true —
  // exit 0 is not success for the docs-sync bot.
  const ok = !result.error && result.status === 0

  // Persist full stderr on every call (not gated on ok/exitCode/summary). Cap is
  // generous (megabytes) so long batch dumps keep auto-rejecting lines; console
  // still uses the short tail above.
  try {
    fs.mkdirSync("docs-sync-out", { recursive: true })
    const safe = label.replace(/[^A-Za-z0-9._-]/g, "-")
    const body = stderrSafe.length > STDERR_LOG_MAX_CHARS ? stderrSafe.slice(-STDERR_LOG_MAX_CHARS) : stderrSafe
    fs.writeFileSync(`docs-sync-out/kilo-stderr-${safe}.log`, body)
  } catch (err) {
    console.warn(`${label}: failed to write kilo-stderr log: ${err.message}`)
  }

  if (result.error && !timedOut) {
    console.warn(`${label}: spawn error: ${result.error.message}`)
  }

  return { ok, stdout: stdoutSafe, stderrTail, exitCode, timedOut }
}
