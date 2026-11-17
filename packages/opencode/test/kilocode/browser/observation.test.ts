import { describe, expect, test } from "bun:test"
import { Tracker, diff, modeFor, observe, split, snapshot } from "../../../src/kilocode/browser/observation"

const first = `### Result
Clicked "Sign in"
### Ran Playwright code
\`\`\`ts
await page.getByRole('button', { name: 'Sign in' }).click();
\`\`\`
### Page
- Page URL: http://localhost:4173/login
- Page Title: Sign in
### Snapshot
\`\`\`yaml
- generic [active] [ref=e1]:
  - heading "Sign in" [level=1] [ref=e2]
  - text "Session expired" [ref=e3]
  - textbox "Email" [ref=e4]
  - button "Sign in" [ref=e5]
\`\`\``

const second = `### Result
Clicked "Sign in"
### Ran Playwright code
\`\`\`ts
await page.getByRole('button', { name: 'Sign in' }).click();
\`\`\`
### Page
- Page URL: http://localhost:4173/login
- Page Title: Sign in
### Modal state
- ["alert" dialog with message "Signed in"]: can be handled by the dialog handler
### Events
- New console entries: .playwright-mcp/console-2026.log#L1-L2
### Snapshot
\`\`\`yaml
- generic [active] [ref=e1]:
  - heading "Welcome back" [level=1] [ref=e2]
  - textbox "Email" [ref=e4]
  - button "Continue" [ref=e6]
  - link "Help" [ref=e7]
\`\`\``

describe("browser observation", () => {
  test("splits sections without breaking on fenced content", () => {
    const sections = split(first)
    expect(sections.map((section) => section.title)).toEqual(["Result", "Ran Playwright code", "Page", "Snapshot"])
  })

  test("reads the page URL, title, and snapshot lines", () => {
    const value = snapshot(split(first))
    expect(value?.url).toBe("http://localhost:4173/login")
    expect(value?.title).toBe("Sign in")
    expect(value?.lines).toEqual([
      "- generic [active] [ref=e1]:",
      '  - heading "Sign in" [level=1] [ref=e2]',
      '  - text "Session expired" [ref=e3]',
      '  - textbox "Email" [ref=e4]',
      '  - button "Sign in" [ref=e5]',
    ])
  })

  test("full mode passes the upstream result through", () => {
    const observed = observe({ mode: "full", text: first })
    expect(observed.text).toBe(first)
    expect(observed.snapshot?.lines.length).toBe(5)
  })

  test("none mode keeps status, URL, title and the result only", () => {
    const observed = observe({ mode: "none", text: first })
    expect(observed.text).toContain("### Status\n- ok")
    expect(observed.text).toContain("- Page URL: http://localhost:4173/login")
    expect(observed.text).toContain("- Page Title: Sign in")
    expect(observed.text).toContain('Clicked "Sign in"')
    expect(observed.text).not.toContain("### Snapshot")
    expect(observed.text).not.toContain("Ran Playwright code")
    expect(observed.text).not.toContain('button "Sign in" [ref=e5]')
  })

  test("diff mode returns the full snapshot on the first visit", () => {
    const observed = observe({ mode: "diff", text: first })
    expect(observed.text).toContain("### Snapshot\n```yaml")
    expect(observed.text).not.toContain("Page changes")
  })

  test("diff mode replaces the snapshot with added, changed and removed lines", () => {
    const baseline = observe({ mode: "full", text: first }).snapshot
    const observed = observe({
      mode: "diff",
      text: second,
      previous: baseline,
      consoleErrors: ["[ERROR] Uncaught TypeError @ http://localhost:4173/app.js:1"],
    })
    expect(observed.text).toContain("### Page\n- Page URL: http://localhost:4173/login")
    expect(observed.text).toContain('### Modal state\n- ["alert" dialog with message "Signed in"]')
    expect(observed.text).toContain("### Events")
    expect(observed.text).toContain("### Console errors\n[ERROR] Uncaught TypeError")
    expect(observed.text).toContain("- added 1, changed 2, removed 1")
    expect(observed.text).toContain('~   - button "Sign in" [ref=e5]\n  - button "Continue" [ref=e6]')
    expect(observed.text).toContain('+   - link "Help" [ref=e7]')
    expect(observed.text).toContain('-   - text "Session expired" [ref=e3]')
    expect(observed.text).not.toContain("### Snapshot")
    expect(observed.text).not.toContain("Ran Playwright code")
    expect(observed.snapshot?.url).toBe("http://localhost:4173/login")
  })

  test("diff counts a replaced line as changed, not as an add and a remove", () => {
    expect(diff(['  - button "Sign in" [ref=e5]'], ['  - button "Continue" [ref=e6]'])).toEqual({
      added: [],
      removed: [],
      changed: [{ from: '  - button "Sign in" [ref=e5]', to: '  - button "Continue" [ref=e6]' }],
    })
  })

  test("an unchanged page reports no snapshot changes", () => {
    const baseline = observe({ mode: "full", text: first }).snapshot
    const observed = observe({ mode: "diff", text: first, previous: baseline })
    expect(observed.text).toContain("### Page changes\n- No snapshot changes")
  })
})

describe("browser snapshot tracker", () => {
  test("diffs each tab against its own last snapshot", () => {
    const tracker = new Tracker()
    tracker.record("s1", { url: "http://localhost/a", lines: ["- a"] })
    tracker.record("s1", { url: "http://localhost/b", lines: ["- b"] })
    expect(tracker.previous("s1", "browser_click", "http://localhost/a")).toEqual({
      url: "http://localhost/a",
      lines: ["- a"],
    })
    expect(tracker.previous("s1", "browser_click", "http://localhost/unknown")).toBeUndefined()
    expect(tracker.previous("s2", "browser_click", "http://localhost/a")).toBeUndefined()
  })

  test("keeps the previous page as the baseline when a navigation changes the URL", () => {
    const tracker = new Tracker()
    tracker.record("s1", { url: "http://localhost/login", lines: ["- login"] })
    expect(tracker.previous("s1", "browser_navigate", "http://localhost/home")?.lines).toEqual(["- login"])
  })

  test("switching tabs without a known snapshot for that tab starts over", () => {
    const tracker = new Tracker()
    tracker.record("s1", { url: "http://localhost/a", lines: ["- a"] })
    expect(tracker.previous("s1", "browser_tabs", "http://localhost/other")).toBeUndefined()
  })

  test("returns only console messages the session has not seen", () => {
    const tracker = new Tracker()
    const text = `### Result
Total messages: 2 (Errors: 2, Warnings: 0)

[ERROR] first @ http://localhost/a.js:1
[ERROR] second @ http://localhost/b.js:1`
    expect(tracker.consoleErrors("s1", text)).toEqual([
      "[ERROR] first @ http://localhost/a.js:1",
      "[ERROR] second @ http://localhost/b.js:1",
    ])
    expect(tracker.consoleErrors("s1", text)).toEqual([])
    expect(tracker.consoleErrors("s2", text).length).toBe(2)
  })
})

describe("explicit observation requests", () => {
  test("a snapshot or find is answered in full in every mode", () => {
    expect(modeFor("browser_snapshot", "none")).toBe("full")
    expect(modeFor("browser_snapshot", "diff")).toBe("full")
    expect(modeFor("browser_find", "none")).toBe("full")
    expect(modeFor("browser_click", "none")).toBe("none")
    expect(modeFor("browser_click", "diff")).toBe("diff")
    expect(modeFor("browser_navigate", "full")).toBe("full")
  })
})
