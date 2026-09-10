import { describe, expect, test } from "bun:test"
import { parsePr, parseRepo, runText, selectPr } from "../src/tui-plugin/sidebar-pr"

describe("parsePr", () => {
  test("accepts the canonical gh view record", () => {
    expect(parsePr('{"number": 2, "title": "Matched"}')).toEqual({ number: 2, title: "Matched" })
  })

  test("fails closed to no PR on malformed and null payloads", () => {
    expect(parsePr("null")).toBeNull()
    expect(parsePr("not json")).toBeNull()
    expect(parsePr("[]")).toBeNull()
    expect(parsePr('{"number": "2", "title": "String number"}')).toBeNull()
    expect(parsePr('{"number": 2}')).toBeNull()
    expect(parsePr('{"title": "No number"}')).toBeNull()
  })
})

describe("selectPr", () => {
  const head = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"

  test("accepts only the candidate whose head commit matches exactly", () => {
    const payload = JSON.stringify([
      { number: 2, title: "Matched", headRefOid: head },
      { number: 9, title: "Other branch", headRefOid: "ffffffffffffffffffffffffffffffffffffffff" },
    ])
    expect(selectPr(payload, head)).toEqual({ number: 2, title: "Matched" })
  })

  test("rejects a PR that merely references the SHA without matching its head", () => {
    const payload = JSON.stringify([
      { number: 3, title: `Rebase of ${head}`, headRefOid: "ffffffffffffffffffffffffffffffffffffffff" },
    ])
    expect(selectPr(payload, head)).toBeNull()
  })

  test("skips malformed and null entries and keeps scanning, like v1", () => {
    const payload = JSON.stringify([
      null,
      { title: "No number", headRefOid: head },
      { number: "4", title: "String number", headRefOid: head },
      { number: 5, headRefOid: head },
      { number: 6, title: "Valid", headRefOid: head },
    ])
    expect(selectPr(payload, head)).toEqual({ number: 6, title: "Valid" })
  })

  test("a null before the valid candidate stays safe", () => {
    const payload = JSON.stringify([null, { number: 7, title: "Valid", headRefOid: head }])
    expect(selectPr(payload, head)).toEqual({ number: 7, title: "Valid" })
  })

  test("returns null when nothing valid and matching exists", () => {
    expect(selectPr(`[null]`, head)).toBeNull()
    expect(selectPr('[{"title": "No number", "headRefOid": "x"}]', head)).toBeNull()
    expect(selectPr('[{"number": 2, "headRefOid": "x"}]', head)).toBeNull()
    expect(selectPr("not json", head)).toBeNull()
    expect(selectPr("[]", head)).toBeNull()
    expect(selectPr(JSON.stringify({ number: 1, title: "Object payload" }), head)).toBeNull()
  })
})

describe("parseRepo", () => {
  test("resolves the fork parent name over the owner/login composite", () => {
    expect(parseRepo('{"nameWithOwner": "o/r", "parent": {"nameWithOwner": "upstream/r"}}')).toBe("upstream/r")
    expect(parseRepo('{"nameWithOwner": "o/r", "parent": {"owner": {"login": "upstream"}, "name": "r"}}')).toBe(
      "upstream/r",
    )
  })

  test("fails closed on malformed, null, self, and empty payloads", () => {
    expect(parseRepo("null")).toBeNull()
    expect(parseRepo("not json")).toBeNull()
    expect(parseRepo('{"parent": {"nameWithOwner": "upstream/r"}}')).toBeNull()
    expect(parseRepo('{"nameWithOwner": "o/r"}')).toBeNull()
    expect(parseRepo('{"nameWithOwner": "o/r", "parent": {"nameWithOwner": "o/r"}}')).toBeNull()
    expect(parseRepo('{"nameWithOwner": "o/r", "parent": {"nameWithOwner": ""}}')).toBeNull()
  })
})

describe("runText", () => {
  test("cancellation terminates the owned child within the kill grace", async () => {
    const controller = new AbortController()
    const started = Date.now()
    const pending = runText(["sleep", "30"], "/tmp", controller.signal)
    await Bun.sleep(200)
    controller.abort()
    const result = await pending
    // The returned code only exists after the child's exit was awaited: a
    // SIGTERM kill yields no exit code, so the call maps it to -1.
    expect(result.code).toBe(-1)
    expect(result.output).toBe("")
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test("a child ignoring SIGTERM is escalated to SIGKILL after the grace", async () => {
    const controller = new AbortController()
    const started = Date.now()
    const pending = runText(["bash", "-c", 'trap "" TERM; sleep 30'], "/tmp", controller.signal)
    await Bun.sleep(200)
    controller.abort()
    const result = await pending
    // The child survived the SIGTERM, so only the retained timer's SIGKILL
    // after the one-second grace could have ended it.
    expect(result.code).toBe(-1)
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(1_000)
    expect(elapsed).toBeLessThan(5_000)
  })

  test("normal completion resolves with its real exit code inside the grace", async () => {
    const started = Date.now()
    const result = await runText(["true"], "/tmp", AbortSignal.any([]))
    expect(result.code).toBe(0)
    const failed = await runText(["false"], "/tmp", AbortSignal.any([]))
    expect(failed.code).toBe(1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
