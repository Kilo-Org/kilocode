import { describe, expect, test } from "bun:test"
import {
  areas,
  classify,
  cleanup,
  easy,
  hasPriority,
  kind,
  needMember,
  parse,
  labels,
  sync,
  priority,
  mention,
  newcomer,
  component,
  pushedAt,
  decide,
  failure,
  clip,
  digest,
  parts,
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

  test("reads product names in the title", () => {
    expect(areas("docs(kilo-docs): update Kilo Desktop docs for 0.1.12", [])).toEqual(["area:desktop", "area:docs"])
    expect(areas("fix: Kilo Desktop blank screen", [])).toEqual(["area:desktop"])
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

  test("a keep-open label counts as triaged", () => {
    expect(classify([author(3)], [label.keep], now)).toEqual({ state: "review" })
  })

  test("a priority label does not count as triaged", () => {
    expect(classify([author(3)], ["priority:p1"], now)).toEqual({ state: "triage" })
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
  test("needs-triage covers new PRs and contributor replies", () => {
    expect(decide([], { state: "triage" })).toEqual({ add: [label.triage], remove: [] })
    expect(decide([], { state: "review" })).toEqual({ add: [label.triage], remove: [] })
    expect(decide([label.triage], { state: "review" })).toEqual({ add: [], remove: [] })
  })

  test("swaps stale status labels", () => {
    const plan = decide([label.community, label.triage], { state: "awaiting", since: 0, days: 1 })
    expect(plan.add).toEqual([label.awaiting])
    expect(plan.remove).toEqual([label.triage])
    expect(decide([label.awaiting], { state: "approved" })).toEqual({ add: [], remove: [label.awaiting] })
  })

  test("never touches hand-set labels", () => {
    const plan = decide([label.high, label.keep, "priority:p1"], { state: "approved" })
    expect(plan).toEqual({ add: [], remove: [] })
  })
})

describe("cleanup", () => {
  test("lists community and status labels", () => {
    const tags = [label.community, label.triage, label.awaiting, "area:cli", "priority:p1", label.high, label.keep]
    expect(cleanup(tags).sort()).toEqual([label.awaiting, label.community, label.triage].sort())
  })

  test("returns nothing for a clean PR", () => {
    expect(cleanup(["area:cli", label.high])).toEqual([])
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
    first: false,
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

describe("parts", () => {
  const row = (num: number, state: Row["state"]): Row => ({
    number: num,
    title: `PR ${num}`,
    url: `https://github.com/o/r/pull/${num}`,
    author: "dev",
    created: ago(4),
    state,
    failing: false,
    adopt: false,
    closed: false,
    first: false,
  })

  test("splits a summary from one block per section", () => {
    const out = parts(
      [row(1, { state: "triage" }), row(2, { state: "triage" }), row(3, { state: "review" })],
      "slack",
      "o/r",
      now,
    )
    expect(out.title).toBe("*Community PR queue for o/r: 3 open*")
    expect(out.counts).toBe("Triage: 2 · Review: 1")
    expect(out.blocks).toHaveLength(2)
    expect(out.blocks[0]).toContain("*Needs triage (2)*")
  })

  test("digest still joins everything", () => {
    const text = digest([row(1, { state: "triage" })], "md", "o/r", now)
    expect(text).toContain("**Community PR queue for o/r: 1 open**")
    expect(text).toContain("**Needs triage (1)**")
  })
})

describe("clip", () => {
  test("keeps short text", () => {
    expect(clip("abc")).toBe("abc")
  })

  test("cuts long text at a line end", () => {
    const text = Array.from({ length: 200 }, (_, i) => `- line ${i} ${"x".repeat(30)}`).join("\n")
    const out = clip(text, 500)
    expect(out.length).toBeLessThan(560)
    expect(out.endsWith("- ...list shortened")).toBe(true)
    expect(out).not.toContain("line 1 x".repeat(40))
  })
})

describe("newcomer", () => {
  test("detects first-time authors", () => {
    expect(newcomer("FIRST_TIME_CONTRIBUTOR")).toBe(true)
    expect(newcomer("FIRST_TIMER")).toBe(true)
  })

  test("ignores returning authors", () => {
    expect(newcomer("CONTRIBUTOR")).toBe(false)
    expect(newcomer("NONE")).toBe(false)
    expect(newcomer(undefined)).toBe(false)
  })
})

describe("easy", () => {
  test("docs only", () => {
    expect(easy(120, ["packages/kilo-docs/pages/a.md", "README.md"])).toBe("docs")
    expect(easy(151, ["packages/kilo-docs/pages/a.md"])).toBeUndefined()
  })

  test("tests only", () => {
    expect(easy(100, ["packages/opencode/test/a.test.ts", "packages/kilo-vscode/tests/unit/b.test.ts"])).toBe("tests")
  })

  test("small change", () => {
    expect(easy(40, ["packages/opencode/src/a.ts", "packages/opencode/src/b.ts"])).toBe("small")
    expect(easy(51, ["packages/opencode/src/a.ts"])).toBeUndefined()
    expect(easy(10, ["a.ts", "b.ts", "c.ts", "d.ts"])).toBeUndefined()
  })

  test("risky paths are never quick wins", () => {
    expect(easy(5, [".github/workflows/x.yml"])).toBeUndefined()
    expect(easy(5, ["bun.lock"])).toBeUndefined()
    expect(easy(5, ["package.json"])).toBeUndefined()
    expect(easy(5, ["patches/x.patch"])).toBeUndefined()
    expect(easy(5, ["packages/kilo-gateway/src/a.ts"])).toBeUndefined()
    expect(easy(5, ["README.md", ".github/CODEOWNERS"])).toBeUndefined()
  })

  test("agent definitions and changesets are not docs", () => {
    expect(easy(10, [".kilo/agent/a.md"])).toBeUndefined()
    expect(easy(10, [".kilo/skills/x/SKILL.md"])).toBeUndefined()
    expect(easy(100, [".changeset/a.md"])).toBeUndefined()
  })

  test("a small fix with a changeset is still small", () => {
    expect(easy(20, ["packages/opencode/src/a.ts", ".changeset/a.md"])).toBe("small")
  })

  test("no files", () => {
    expect(easy(0, [])).toBeUndefined()
  })
})

describe("digest with quick wins and newcomers", () => {
  const base: Row = {
    number: 1,
    title: "docs: fix typo",
    url: "https://github.com/o/r/pull/1",
    author: "new",
    created: ago(2),
    state: { state: "triage" },
    failing: false,
    adopt: false,
    closed: false,
    first: true,
    quick: "docs",
  }

  test("lists quick wins and marks first-time contributors", () => {
    const text = digest([base], "md", "o/r", now)
    expect(text).toContain("**Quick wins: small and low-risk (1)**")
    expect(text).toContain("docs only, first-time contributor")
  })

  test("counts show quick wins and newcomers", () => {
    const out = parts([base], "slack", "o/r", now)
    expect(out.counts).toBe("Quick: 1 · Triage: 1 · First-time: 1")
  })

  test("skips quick wins that wait for the contributor", () => {
    const row: Row = { ...base, state: { state: "awaiting", since: ago(3), days: 3 } }
    expect(digest([row], "md", "o/r", now)).not.toContain("Quick wins")
  })
})

describe("cleanup of new labels", () => {
  test("removes first-time and quick-win from maintainer PRs", () => {
    expect(cleanup([label.first, label.quick, "area:cli"]).sort()).toEqual([label.first, label.quick].sort())
  })
})

describe("failure", () => {
  test("names the missing scope", () => {
    expect(failure({ error: "missing_scope", needed: "chat:write", provided: "incoming-webhook" })).toBe(
      "Slack chat.postMessage failed: missing_scope (needed: chat:write, provided: incoming-webhook)",
    )
  })

  test("handles replies without scope details", () => {
    expect(failure({ error: "not_in_channel" })).toBe("Slack chat.postMessage failed: not_in_channel")
    expect(failure({})).toBe("Slack chat.postMessage failed: unknown error")
  })
})

describe("mention", () => {
  test("finds product names, ignoring case", () => {
    expect(mention("Deleting a chat has no confirmation (Kilo Desktop)")).toEqual(["area:desktop"])
    expect(mention("kilo desktop will not start")).toEqual(["area:desktop"])
    expect(mention("JetBrains plugin and Agent Manager")).toEqual(["area:agent-manager", "area:jetbrains"])
  })

  test("ignores other titles", () => {
    expect(mention("Desktop notifications in VS Code")).toEqual([])
    expect(mention("Anaconda Desktop integration")).toEqual([])
    expect(mention("fix: crash on start")).toEqual([])
  })
})

describe("kind", () => {
  test("conventional prefixes win", () => {
    expect(kind("fix(cli): crash", [])).toBe("fix")
    expect(kind("Fixes race in sync", [])).toBe("fix")
    expect(kind("revert: bad change", [])).toBe("fix")
    expect(kind("docs: update readme", [])).toBe("docs")
    expect(kind("feat(vscode): dark mode", [])).toBe("feature")
    expect(kind("fix: typo in docs", ["documentation"])).toBe("fix")
  })

  test("labels come next", () => {
    expect(kind("Handle edge case", ["bug"])).toBe("fix")
    expect(kind("Update guide", ["Documentation"])).toBe("docs")
    expect(kind("Shiny thing", ["enhancement"])).toBe("feature")
  })

  test("docs by area needs docs to be the only area", () => {
    expect(kind("Update guide", ["area:docs"])).toBe("docs")
    expect(kind("Update guide", ["area:docs", "area:cli"])).toBe("other")
  })

  test("verbs and fallback", () => {
    expect(kind("Add support for X", [])).toBe("feature")
    expect(kind("Misc cleanup", [])).toBe("other")
  })
})

describe("priority", () => {
  test("maps the type to a level", () => {
    expect(priority("fix: crash", [])).toBe("priority:p1")
    expect(priority("feat: thing", [])).toBe("priority:p2")
    expect(priority("Misc cleanup", [])).toBe("priority:p2")
    expect(priority("docs: guide", [])).toBe("priority:p3")
  })

  test("never changes an existing priority", () => {
    expect(priority("fix: crash", ["priority:p3"])).toBeUndefined()
    expect(hasPriority(["priority:p0"])).toBe(true)
    expect(hasPriority(["priority:p9", "bug"])).toBe(false)
  })

  test("is never P0", () => {
    for (const title of ["fix: security crash", "feat: x", "docs: y", "other"]) {
      expect(priority(title, [])).not.toBe("priority:p0")
    }
  })
})

describe("sync", () => {
  const want = [
    { name: "a", color: "ffffff", description: "First" },
    { name: "b", color: "000000", description: "Second" },
    { name: "c", color: "111111", description: "Third" },
  ]

  test("creates missing labels and updates changed ones", () => {
    const have = [
      { name: "A", color: "FFFFFF", description: "First" },
      { name: "b", color: "000000", description: "Old text" },
    ]
    const out = sync(have, want)
    expect(out.create.map((item) => item.name)).toEqual(["c"])
    expect(out.update.map((item) => item.name)).toEqual(["b"])
  })

  test("a changed color counts, and a missing description is empty", () => {
    const out = sync([{ name: "a", color: "123456", description: null }], [want[0]])
    expect(out.update.map((item) => item.name)).toEqual(["a"])
    expect(
      sync([{ name: "a", color: "ffffff", description: null }], [{ name: "a", color: "ffffff", description: "" }]),
    ).toEqual({
      create: [],
      update: [],
    })
  })

  test("does nothing when the repo matches", () => {
    expect(sync(want, want)).toEqual({ create: [], update: [] })
  })
})

describe("label list", () => {
  test("descriptions fit the 100 character GitHub limit", () => {
    for (const item of labels) expect(item.description.length).toBeLessThanOrEqual(100)
  })

  test("names are unique", () => {
    const names = labels.map((item) => item.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })
})

describe("parse", () => {
  test("reads logins in lower case", () => {
    expect([...parse({ logins: ["Some-Login", "other"] })]).toEqual(["some-login", "other"])
  })

  test("rejects bad shapes", () => {
    expect(() => parse(null)).toThrow()
    expect(() => parse({})).toThrow()
    expect(() => parse({ logins: "a" })).toThrow()
    expect(() => parse({ logins: [1] })).toThrow()
    expect(() => parse({ logins: ["has space"] })).toThrow()
    expect(() => parse({ logins: ["-bad"] })).toThrow()
    expect(() => parse({ logins: ["bot[bot]"] })).toThrow()
  })
})

describe("community-maintainers.json", () => {
  const file = new URL("../../.github/community-maintainers.json", import.meta.url)

  test("parses", async () => {
    expect(parse(await Bun.file(file).json()).size).toBeGreaterThan(0)
  })

  test("is sorted, lower case and without duplicates", async () => {
    const list = ((await Bun.file(file).json()) as { logins: string[] }).logins
    expect(list).toEqual([...new Set(list.map((item) => item.toLowerCase()))].sort())
  })
})

describe("needMember", () => {
  test("fails when the token is missing or empty", () => {
    expect(() => needMember(undefined)).toThrow("COMMUNITY_TRIAGE_MEMBER_TOKEN is not set")
    expect(() => needMember("")).toThrow("COMMUNITY_TRIAGE_MEMBER_TOKEN is not set")
  })

  test("accepts a token", () => {
    expect(() => needMember("token")).not.toThrow()
  })
})
