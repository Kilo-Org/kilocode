// Find open Dependabot alerts that the repo no longer shows.
//
// Dependabot normally closes an alert when the fix lands, but an alert can
// stay open after the manifest is deleted or after a lockfile moves to a
// patched version (for example an alert on a removed app, or an override that
// pins a new release). This script compares each open npm alert with the
// lockfiles in the checkout and prints `{ count, text }`: `text` is the Slack
// message. It only reports. A person decides whether to dismiss the alert.
//
// Only `bun.lock` and `pnpm-lock.yaml` are parsed. Alerts for other
// ecosystems or lockfile formats are skipped, never reported.

import { existsSync, readFileSync } from "node:fs"

export type Alert = {
  number: number
  html_url: string
  dependency: { package: { name: string; ecosystem: string }; manifest_path: string }
  security_vulnerability: { vulnerable_version_range: string }
}

type Read = (path: string) => string | undefined

const LOCKS = ["bun.lock", "pnpm-lock.yaml"]

// Every version of `name` that a lockfile resolves. A bun.lock entry looks like
// `"simple-git": ["simple-git@3.36.0", ...]` and a pnpm entry like
// `  simple-git@3.36.0:` or `(simple-git@3.36.0)`. The lookbehind keeps
// `marked-katex-extension@1.0.0` from matching `katex`.
export function versions(text: string, name: string) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(?<![A-Za-z0-9._/-])${esc}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`, "g")
  return [...new Set([...text.matchAll(re)].map((match) => match[1]))]
}

export function vulnerable(version: string, range: string) {
  return Bun.semver.satisfies(version, range.replace(/,/g, " "))
}

function dir(path: string) {
  const idx = path.lastIndexOf("/")
  return idx < 0 ? "" : path.slice(0, idx + 1)
}

// Lockfiles that can answer for a manifest. A workspace package.json is
// resolved by its own lockfile or by the root one.
function locks(manifest: string) {
  const name = manifest.split("/").at(-1) ?? ""
  if (LOCKS.includes(name)) return [manifest]
  if (name !== "package.json") return []
  return [...new Set([dir(manifest), ""].flatMap((base) => LOCKS.map((lock) => base + lock)))]
}

// Why this alert looks stale, or undefined when it still applies or cannot be
// checked.
export function check(alert: Alert, read: Read) {
  if (alert.dependency.package.ecosystem !== "npm") return undefined
  const manifest = alert.dependency.manifest_path
  if (read(manifest) === undefined) return "manifest no longer exists"

  const files = locks(manifest).flatMap((path) => {
    const body = read(path)
    return body === undefined ? [] : [body]
  })
  if (files.length === 0) return undefined

  const name = alert.dependency.package.name
  const found = [...new Set(files.flatMap((body) => versions(body, name)))]
  if (found.length === 0) return "package is no longer in the lockfile"
  if (found.some((version) => vulnerable(version, alert.security_vulnerability.vulnerable_version_range))) {
    return undefined
  }
  return `lockfile resolves ${found.join(", ")}, outside the vulnerable range`
}

// Lines in the Slack message. The job summary lists everything.
const LIMIT = 20

export function report(alerts: Alert[], read: Read, url?: string) {
  const stale = alerts.flatMap((alert) => {
    const reason = check(alert, read)
    return reason ? [{ alert, reason }] : []
  })
  if (stale.length === 0) return { count: 0, text: "", full: "" }

  const line = (item: (typeof stale)[number]) =>
    `- <${item.alert.html_url}|#${item.alert.number}> \`${item.alert.dependency.package.name}\` (${item.alert.dependency.manifest_path}): ${item.reason}`
  const title = `*Open Dependabot alerts that look stale: ${stale.length}*`
  const note = "Check each one and dismiss it if the fix is real. Nothing is dismissed automatically."
  const text = [
    title,
    ...stale.slice(0, LIMIT).map(line),
    stale.length > LIMIT ? `- ...and ${stale.length - LIMIT} more (see the job summary)` : "",
    note,
    url ? `<${url}|Workflow run>` : "",
  ]
    .filter(Boolean)
    .join("\n")
  return { count: stale.length, text, full: [title, ...stale.map(line), note].join("\n") }
}

async function run() {
  const alerts: Alert[] = await Bun.file(process.argv[2]).json()
  const read: Read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined)
  console.log(JSON.stringify(report(alerts, read, process.env.RUN_URL)))
}

if (import.meta.main) await run()
