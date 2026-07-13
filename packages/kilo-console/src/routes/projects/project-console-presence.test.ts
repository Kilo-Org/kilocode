/**
 * Contract test for the presence snapshot logic in ProjectConsoleRoute.tsx.
 *
 * The route is a large Solid component that cannot be mounted in a unit test,
 * so these source assertions pin the load-bearing presence behaviour instead:
 * the console is a dashboard viewer (always inactive, never reports visible
 * sessions), the attached union covers the selected session plus every terminal
 * session, a 60s check-in re-sends the snapshot, and cleanup reuses the exact
 * url+dir the last regular snapshot used (review finding P2-2) to post a final
 * empty snapshot, swallowing errors.
 */

import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROUTE_FILE = path.resolve(import.meta.dir, "./ProjectConsoleRoute.tsx")

/** Collapse whitespace so multi-line expressions match regardless of formatting. */
function flat(source: string) {
  return source.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/,\)/g, ")")
}

describe("project console presence contract", () => {
  test("snapshots always report an inactive viewer with no visible sessions", () => {
    const content = fs.readFileSync(ROUTE_FILE, "utf-8")
    expect(content).toContain("const viewerId = crypto.randomUUID()")
    expect(flat(content)).toContain(
      "void viewProjectSessions(lastInput, { id: viewerId, active: false }, [...ids], [])",
    )
    expect(content).not.toContain("active: true")
  })

  test("attached union includes the selected session and every terminal session", () => {
    const content = fs.readFileSync(ROUTE_FILE, "utf-8")
    expect(content).toContain("const selected = activeSessionID()")
    expect(content).toContain("const ids = new Set<string>()")
    expect(content).toContain("if (selected) ids.add(selected)")
    expect(flat(content)).toContain(
      "for (const item of terminals()) { const id = sessionID(item) if (id) ids.add(id) }",
    )
  })

  test("snapshots record the url+dir they were sent with", () => {
    const content = fs.readFileSync(ROUTE_FILE, "utf-8")
    expect(content).toContain("let lastInput: { url: string; dir: string } | undefined")
    expect(content).toContain("lastInput = { url: base.url, dir: data.project.worktree }")
  })

  test("reactive snapshots are deduplicated while 60s check-ins always renew the lease", () => {
    const content = fs.readFileSync(ROUTE_FILE, "utf-8")
    expect(content).toContain("function sendSnapshot(force = false)")
    expect(content).toContain("if (pendingKeys.has(key)) return")
    expect(content).toContain("if (!force && key === lastSentKey) return")
    expect(content).toContain("lastSentKey = key")
    expect(content).toContain("createEffect(() => sendSnapshot())")
    expect(content).toContain("const checkin = window.setInterval(() => sendSnapshot(true), 60_000)")
    expect(content).toContain("window.clearInterval(checkin)")
  })

  test("cleanup posts a final empty snapshot reusing the last snapshot's url+dir, swallowing errors", () => {
    const content = flat(fs.readFileSync(ROUTE_FILE, "utf-8"))
    // clearInterval and the final send live in the same onCleanup block, and the
    // final send targets lastInput — not the raw query dir (review finding P2-2).
    expect(content).toContain(
      "window.clearInterval(checkin) if (lastInput) { void viewProjectSessions(lastInput, { id: viewerId, active: false }, [], []).catch(() => {}) }",
    )
    expect(content).not.toContain("dir: base.dir")
  })
})
