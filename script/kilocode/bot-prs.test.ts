import { describe, expect, test } from "bun:test"
import { groups, pkg, text, type Flagged, type Pr } from "./bot-prs"

const pr = (number: number, title: string, login = "kilo-code-bot"): Pr => ({
  number,
  title,
  url: `https://github.com/o/r/pull/${number}`,
  author: { login },
})

const flag = (item: Pr, reason = "unreviewed"): Flagged => ({ ...item, age_days: 4, reason })

describe("bot-prs pkg", () => {
  test("reads the package from upgrade, bump and update titles", () => {
    expect(pkg("fix: upgrade simple-git to 4.0.2 for CVE-2026-102826")).toBe("simple-git")
    expect(pkg("fix(kilo-docs): bump source-map-js to 1.2.2 for CVE-2026-93749")).toBe("source-map-js")
    expect(pkg("chore(deps): bump katex from 0.16.27 to 0.18.2 in /packages/session-ui")).toBe("katex")
    expect(pkg("chore: update @scope/Pkg to 2.0.0")).toBe("@scope/pkg")
  })

  test("ignores grouped titles and titles without a version", () => {
    expect(pkg("chore(deps): bump the kilo-docs-minor-patch group across 1 directory with 3 updates")).toBeUndefined()
    expect(pkg("docs: update the readme")).toBeUndefined()
    expect(pkg("fix(vscode): preserve message ordering")).toBeUndefined()
  })
})

describe("bot-prs groups", () => {
  test("keeps only packages with more than one open PR", () => {
    const list = [
      pr(1, "fix: upgrade simple-git to 4.0.1"),
      pr(2, "fix: upgrade simple-git to 4.0.2 for GHSA-x"),
      pr(3, "fix(kilo-docs): bump source-map-js to 1.2.2"),
    ]
    const found = groups(list)
    expect(found.map(([key]) => key)).toEqual(["simple-git"])
    expect(found[0][1].map((item) => item.number)).toEqual([1, 2])
  })
})

describe("bot-prs text", () => {
  test("is empty when nothing is flagged", () => {
    expect(text([], [pr(1, "fix: upgrade simple-git to 4.0.1")])).toBe("")
  })

  test("collapses duplicates into one line and counts unflagged members", () => {
    const a = pr(1, "fix: upgrade simple-git to 4.0.1")
    const b = pr(2, "fix: upgrade simple-git to 4.0.2")
    const c = pr(3, "fix: upgrade simple-git to 4.0.2 for GHSA-x")
    const out = text([flag(a), flag(b)], [a, b, c])
    const lines = out.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("3 open bot PRs touch `simple-git`")
    expect(lines[1]).toContain("#1")
    expect(lines[1]).toContain("#3")
  })

  test("lists a flagged PR on its own when it has no duplicates", () => {
    const a = pr(1, "fix(vscode): preserve message ordering")
    const b = pr(2, "fix: upgrade simple-git to 4.0.1")
    const out = text([flag(a, "CI failing")], [a, b])
    expect(out).toContain("<https://github.com/o/r/pull/1|#1 fix(vscode): preserve message ordering>")
    expect(out).toContain("CI failing")
    expect(out).not.toContain("likely duplicates")
  })

  test("skips a duplicate group when none of its PRs is flagged", () => {
    const a = pr(1, "fix: upgrade simple-git to 4.0.1")
    const b = pr(2, "fix: upgrade simple-git to 4.0.2")
    const c = pr(3, "fix(vscode): preserve message ordering")
    const out = text([flag(c)], [a, b, c])
    expect(out).not.toContain("simple-git")
    expect(out).toContain("#3")
  })
})
