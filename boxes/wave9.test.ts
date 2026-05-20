/**
 * wave9.test.ts — Continue.dev + onlook + cursorrules patterns
 */
import { describe, test, expect } from "bun:test"
import { parseUnifiedDiff, applyDiff, applyUnifiedDiff } from "./diff-apply"
import { fuzzyMatch, scoreCandidate, tabComplete, jaccard } from "./tab-complete"
import { rankContext, type Snippet } from "./context-rank"

// ── diff-apply ─────────────────────────────────────

describe("diff-apply", () => {
  test("parseUnifiedDiff extracts hunks", () => {
    const hunks = parseUnifiedDiff("@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line3")
    expect(hunks.length).toBe(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].oldCount).toBe(3)
  })

  test("applyDiff replaces lines", () => {
    const source = "a\nb\nc\nd"
    const hunks = [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1, lines: ["-b", "+B"] }]
    expect(applyDiff(source, hunks)).toBe("a\nB\nc\nd")
  })

  test("applyDiff handles insert", () => {
    const source = "a\nb"
    const hunks = [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, lines: ["+inserted"] }]
    expect(applyDiff(source, hunks)).toBe("inserted\na\nb")
  })

  test("applyDiff handles delete", () => {
    const source = "a\nb\nc"
    const hunks = [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 0, lines: ["-b"] }]
    expect(applyDiff(source, hunks)).toBe("a\nc")
  })

  test("applyUnifiedDiff end-to-end", () => {
    const src = "hello\nworld\nfoo"
    const diff = "@@ -1,2 +1,2 @@\n hello\n-world\n+World"
    const result = applyUnifiedDiff(src, diff)
    expect(result).toContain("World")
    expect(result).toContain("hello")
    expect(result).toContain("foo")
  })
})

// ── tab-complete ───────────────────────────────────

describe("tab-complete", () => {
  test("fuzzyMatch exact", () => { expect(fuzzyMatch("abc", "abc")).toBe(true) })
  test("fuzzyMatch subsequence", () => { expect(fuzzyMatch("hlo", "hello")).toBe(true) })
  test("fuzzyMatch fails on wrong order", () => { expect(fuzzyMatch("oh", "hello")).toBe(false) })

  test("scoreCandidate exact match highest", () => {
    expect(scoreCandidate("foo", "foo")).toBe(100)
  })
  test("scoreCandidate prefix", () => {
    expect(scoreCandidate("get", "getUser")).toBe(80)
  })
  test("scoreCandidate substring", () => {
    expect(scoreCandidate("ser", "getUser")).toBe(60)
  })
  test("scoreCandidate fuzzy", () => {
    expect(scoreCandidate("gur", "getUser")).toBe(40)
  })

  test("tabComplete returns ranked results", () => {
    const candidates = ["formatBytes", "formatDuration", "getUser", "getUserId", "formatDate"]
    const result = tabComplete("get", candidates)
    expect(result.length).toBe(2)
    expect(result[0]).toBe("getUser")
  })

  test("tabComplete respects topK", () => {
    const result = tabComplete("a", ["a1", "a2", "a3", "a4"], 2)
    expect(result.length).toBe(2)
  })

  test("jaccard similarity", () => {
    expect(jaccard("hello world", "hello")).toBeCloseTo(0.5, 1)
    expect(jaccard("abc", "xyz")).toBe(0)
  })
})

// ── context-rank ───────────────────────────────────

describe("context-rank", () => {
  const snippets: Snippet[] = [
    { id: "1", text: "function addUser(name: string) { return db.insert(name) }" },
    { id: "2", text: "const config = { port: 3000, host: 'localhost' }" },
    { id: "3", text: "export async function deleteUser(id: number) { await db.delete(id) }" },
    { id: "4", text: "interface User { name: string; age: number }" },
  ]

  test("rankContext ranks relevant snippets higher", () => {
    const ranked = rankContext("user management", snippets, 4)
    expect(ranked.length).toBe(4)
    const ids = ranked.map(s => s.id)
    expect(ids).toContain("1")
    expect(ids).toContain("3")
  })

  test("rankContext respects topK", () => {
    const ranked = rankContext("config", snippets, 2)
    expect(ranked.length).toBe(2)
  })

  test("rankContext handles short query", () => {
    const ranked = rankContext("user", snippets, 5)
    expect(ranked.length).toBeGreaterThan(0)
  })
})
