import { describe, expect, test } from "bun:test"
import {
  areas,
  classify,
  component,
  pushedAt,
  decide,
  digest,
  DAY,
  label,
  type Event,
  type Row,
} from "./community-triage"

const now = Date.UTC(2026, 9, 8)
const ago = (days: number) => now - days * DAY

describe("areas", () => {
  test("reads the title scope", () => {
    expect(areas("fix(vscode): crash on start", [])).toEqual(["area:vscode"])
    expect(areas("feat(tui)!: new thing", [])).toEqual(["area:cli"])
  })

  test("reads changed paths and prefers agent-manager over vscode", () => {
    const files = ["packages/kilo-vscode/src/agent-manager/a.ts", "packages/kilo-vscode/src/x.ts", "README.md"]
    expect(areas("fix: thing", files)).toEqual(["area:agent-manager", "area:vscode"])
  })

  test("returns nothing for unknown scope and paths", () => {
    expect(areas("chore: misc", ["script/x.ts"])).toEqual([])
  })

  test("ignores inherited object keys in the scope", () => {
    expect(areas("fix(constructor): x", [])).toEqual([])
    expect(areas("fix(__proto__): x", [])).toEqual([])
    expect(areas("fix(toString): x", [])).toEqual([])
  })

  test("maps the web UI package", () => {
    expect(areas("fix: x", ["packages/kilo-web-ui/src/a.ts"])).toEqual(["area:desktop"])
  })
})

describe("component", () => {
  test("maps the issue form answer", () => {
    expect(component("### Description\n\nhi\n\n### Component\n\nJetBrains plugin\n\n### Other\n\nx")).toBe(
      "area:jetbrains",
    )
  })

  test("skips a typed heading with no known answer", () => {
    expect(component("### Component\n\nmy text\n\n### Component\n\nSDK")).toBe("area:sdk")
  })

  test("ignores inherited object keys in the answer", () => {
    expect(component("### Component\n\nconstructor")).toBeUndefined()
    expect(component("### Component\n\n__proto__")).toBeUndefined()
  })

  test("ignores other answers", () => {
    expect(component("### Component\n\nOther / not sure")).toBeUndefined()
    expect(component("no form")).toBeUndefined()
  })
})

describe("pushedAt", () => {
  test("keeps past commit dates", () => {
    expect(pushedAt(new Date(ago(2)).toISOString(), now)).toBe(ago(2))
  })

  test("allows a small clock skew", () => {
    expect(pushedAt(new Date(now + 60_000).toISOString(), now)).toBe(now + 60_000)
  })

  test("ignores future commit dates", () => {
    expect(pushedAt(new Date(now + DAY).toISOString(), now)).toBeUndefined()
  })
})

describe("classify", () => {
  const maintainer = (days: number, approve = false): Event => ({ who: "maintainer", at: ago(days), approve })
  const author = (days: number): Event => ({ who: "author", at: ago(days) })

  test("needs triage without maintainer reaction", () => {
    expect(classify([author(3)], [], now)).toEqual({ state: "triage" })
  })

  test("a high-value label moves a PR to needs-review", () => {
    expect(classify([author(3)], [label.high], now)).toEqual({ state: "review" })
  })

  test("waits for the contributor after a maintainer reaction", () => {
    expect(classify([author(5), maintainer(3)], [], now)).toEqual({ state: "awaiting", since: ago(3), days: 3 })
  })

  test("contributor reply moves the turn back", () => {
    expect(classify([maintainer(5), author(2)], [], now)).toEqual({ state: "review" })
  })

  test("approval is ready to merge until the author pushes again", () => {
    expect(classify([author(5), maintainer(3, true)], [], now)).toEqual({ state: "approved" })
    expect(classify([maintainer(3, true), author(1)], [], now)).toEqual({ state: "review" })
  })
})

describe("decide", () => {
  test("swaps stale status labels", () => {
    const plan = decide([label.community, label.triage, label.ci], { state: "review" }, false)
    expect(plan.add).toEqual([label.review])
    expect(plan.remove.sort()).toEqual([label.ci, label.triage].sort())
  })

  test("never touches hand-set labels", () => {
    const plan = decide([label.high, label.keep, label.adopt], { state: "approved" }, false)
    expect(plan).toEqual({ add: [], remove: [] })
  })
})

describe("digest", () => {
  const row = (num: number, state: Row["state"], more: Partial<Row> = {}): Row => ({
    number: num,
    title: `PR ${num}`,
    url: `https://github.com/o/r/pull/${num}`,
    author: "dev",
    created: ago(4),
    state,
    failing: false,
    adopt: false,
    closed: false,
    ...more,
  })

  test("groups rows and skips empty sections", () => {
    const text = digest(
      [row(1, { state: "triage" }), row(2, { state: "awaiting", since: ago(9), days: 9 })],
      "md",
      "o/r",
      now,
    )
    expect(text).toContain("2 open")
    expect(text).toContain("**Needs triage (1)**")
    expect(text).toContain("[#1 PR 1](https://github.com/o/r/pull/1)")
    expect(text).toContain("9d of 14")
    expect(text).not.toContain("Approved")
  })

  test("lists adopt candidates and closed PRs", () => {
    const text = digest(
      [
        row(1, { state: "awaiting", since: ago(20), days: 20 }, { adopt: true }),
        row(2, { state: "awaiting", since: ago(30), days: 30 }, { closed: true }),
      ],
      "slack",
      "o/r",
      now,
    )
    expect(text).toContain("*Adopt: high-value, no reply in 14 days (1)*")
    expect(text).toContain("<https://github.com/o/r/pull/1|#1 PR 1>")
    expect(text).toContain("*Closed in this run (1)*")
    expect(text).toContain("1 open")
  })

  test("caps long lists", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(i + 1, { state: "triage" }))
    expect(digest(rows, "md", "o/r", now)).toContain("...and 5 more")
  })
})
