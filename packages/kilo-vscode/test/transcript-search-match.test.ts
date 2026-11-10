import { describe, expect, it } from "bun:test"
import type { SessionMessageAssistant, SessionMessageUser } from "@opencode/client"
import type { TranscriptRow } from "../webview-ui/src/v2/transcript"
import { buildSearchPattern, searchMatches } from "../webview-ui/src/v2/transcript-search-match"

const text = (value: string) => ({ type: "text", text: value }) as SessionMessageAssistant["content"][number]

const assistant = (parts: SessionMessageAssistant["content"], start = 0) =>
  ({
    type: "assistant",
    key: "row-1",
    turn: "turn-1",
    message: { id: "message-1", type: "assistant", content: parts },
    start,
    parts,
  }) as unknown as TranscriptRow

const user = (value: string, key = "row-1") =>
  ({
    type: "user",
    key,
    turn: "turn-1",
    message: { id: "message-1", type: "user", text: value, time: { created: 1 } } as SessionMessageUser,
  }) as unknown as TranscriptRow

describe("buildSearchPattern", () => {
  it("matches the query literally unless regex mode is on", () => {
    const literal = buildSearchPattern("a.b", false, false, false)!
    expect(literal.test("xa.by")).toBe(true)
    expect(literal.test("xaxby")).toBe(false)

    const expression = buildSearchPattern("a.b", false, false, true)!
    expect(expression.test("xaxby")).toBe(true)
  })

  it("honors match case", () => {
    expect(buildSearchPattern("Walrus", false, false, false)!.test("walrus")).toBe(true)
    expect(buildSearchPattern("Walrus", true, false, false)!.test("walrus")).toBe(false)
    expect(buildSearchPattern("Walrus", true, false, false)!.test("Walrus")).toBe(true)
  })

  it("uses Unicode word boundaries for whole-word matching", () => {
    const whole = buildSearchPattern("мир", false, true, false)!
    expect(whole.test("Привет, мир!")).toBe(true)
    expect(whole.test("смирение")).toBe(false)

    const partial = buildSearchPattern("мир", false, false, false)!
    expect(partial.test("смирение")).toBe(true)
  })

  it("returns undefined for an invalid regular expression", () => {
    expect(buildSearchPattern("(", false, false, true)).toBeUndefined()
  })

  it("returns undefined for an empty query", () => {
    expect(buildSearchPattern("", false, false, false)).toBeUndefined()
  })
})

describe("searchMatches", () => {
  it("lists every occurrence in row order with its occurrence index", () => {
    const rows = [user("walrus walrus", "row-1"), user("walrus", "row-2")]
    const matches = searchMatches(rows, buildSearchPattern("walrus", false, false, false))
    expect(matches).toEqual([
      { key: "row-1", occurrence: 0, partId: undefined },
      { key: "row-1", occurrence: 1, partId: undefined },
      { key: "row-2", occurrence: 0, partId: undefined },
    ])
  })

  it("attributes a hit inside one assistant part to that part", () => {
    const row = assistant([text("see walrus"), text("walrus twice")])
    const matches = searchMatches([row], buildSearchPattern("walrus", false, false, false))
    expect(matches).toEqual([
      { key: "row-1", occurrence: 0, partId: "message-1:0" },
      { key: "row-1", occurrence: 1, partId: "message-1:1" },
    ])
  })

  it("leaves a hit that crosses the part joiner unattributed", () => {
    const row = assistant([text("alpha"), text("beta")])
    const matches = searchMatches([row], buildSearchPattern("alpha\\nbeta", false, false, true))
    expect(matches).toEqual([{ key: "row-1", occurrence: 0, partId: undefined }])
  })

  it("skips empty regex matches instead of looping", () => {
    const matches = searchMatches([user("ab")], buildSearchPattern("x*", false, false, true))
    expect(matches).toEqual([])
  })

  it("does not search error rows", () => {
    const error = {
      type: "error",
      key: "row-2",
      turn: "turn-1",
      message: { id: "message-2", type: "idle" },
      error: {},
    }
    expect(searchMatches([error as unknown as TranscriptRow], buildSearchPattern("walrus", false, false, false))).toEqual(
      [],
    )
  })
})
