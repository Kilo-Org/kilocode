import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf-8")

/**
 * Regressions that are cheap to verify statically and expensive to notice at
 * runtime: a hosted prompt routed to a stale cloud preview, hosted sessions
 * rendering outside the history panel region, and hosted streams that are
 * never released.
 */
describe("hosted session wiring", () => {
  it("clears the cloud preview when a hosted session is selected", () => {
    const source = read("webview-ui/src/context/session.tsx")
    const start = source.indexOf("function selectHostedSession")
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 400)
    expect(body).toMatch(/setCloudPreviewId\(null\)/)
  })

  it("never falls back to a cloud preview for a hosted session", () => {
    const source = read("webview-ui/src/context/session.tsx")
    const guards = source.match(/origin === undefined && !sid\?\.startsWith\("host:"\)/g) ?? []
    expect(guards).toHaveLength(2)
  })

  it("renders the hosted panel outside the tab list", () => {
    const source = read("webview-ui/src/components/history/HistoryView.tsx")
    const tabs = source.indexOf('class="history-view-tabs"')
    const hosted = source.indexOf('id="history-panel-hosted"')
    expect(tabs).toBeGreaterThan(-1)
    expect(hosted).toBeGreaterThan(-1)
    const between = source.slice(tabs, hosted)
    expect(between.includes('id="history-panel-cloud"')).toBe(true)
  })

  it("releases hosted subscriptions when a session is no longer open", () => {
    const source = read("src/KiloProvider.ts")
    const start = source.indexOf("private trackOpenSessions")
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 800)
    expect(body).toMatch(/this\.releaseHosted\(key\)/)
  })
})
