import { describe, expect, test } from "bun:test"
import { RecallSearch } from "../src/recall/search"

type SearchSession = RecallSearch.Session
type SearchMessage = RecallSearch.Message
type Part = RecallSearch.Part

let clock = 0

function session(
  id: string,
  title: string,
  entries: ReadonlyArray<{ role: "user" | "assistant"; parts: ReadonlyArray<{ text: string; kind?: Part["kind"] }> }> = [],
): SearchSession {
  clock++
  return {
    id,
    title,
    directory: "/project",
    updated: clock,
    messages: entries.map((entry, messageIndex): SearchMessage => {
      const messageID = `msg_${id}_${messageIndex}`
      return {
        id: messageID,
        role: entry.role,
        parts: entry.parts.map((part, partIndex): Part => ({
          id: `${messageID}:${partIndex}`,
          kind: part.kind ?? "text",
          text: part.text,
        })),
      }
    }),
  }
}

const run = (query: string, sessions: ReadonlyArray<SearchSession>, extra: { signal?: AbortSignal } = {}) =>
  RecallSearch.search({ query, sessions, ...extra })

describe("recall search ranking", () => {
  test("searches titles and terms distributed across transcript messages", () => {
    const quartz = session("ses_quartz", "Quartz migration", [
      { role: "user", parts: [{ text: "Investigate the zephyr request path" }] },
      { role: "assistant", parts: [{ text: "The cobalt adapter needs a bounded scan" }] },
    ])

    expect(run("quartz", [quartz]).results.map((item) => item.id)).toEqual([quartz.id])
    const distributed = run("zephyr cobalt", [quartz])
    expect(distributed.results.map((item) => item.id)).toEqual([quartz.id])
    expect(distributed.results[0]?.matches.map((item) => item.source)).toEqual(["user", "assistant"])
  })

  test("ranks a title match above a user match and a user match above an assistant match", () => {
    const title = session("ses_title", "ranking-needle")
    const user = session("ses_user", "User rank", [{ role: "user", parts: [{ text: "ranking-needle" }] }])
    const assistant = session("ses_assistant", "Assistant rank", [
      { role: "assistant", parts: [{ text: "ranking-needle" }] },
    ])
    expect(run("ranking-needle", [assistant, user, title]).results.map((item) => item.id)).toEqual([
      title.id,
      user.id,
      assistant.id,
    ])
  })

  test("ranks whole-word matches above inner-word matches", () => {
    const inner = session("ses_inner", "Inner", [
      { role: "user", parts: [{ text: "the category filter concatenates values" }] },
    ])
    const whole = session("ses_whole", "Whole", [
      { role: "user", parts: [{ text: "the category filter and the cat photo" }] },
    ])
    const result = run("cat", [inner, whole])
    expect(result.results.map((item) => item.id)).toEqual([whole.id, inner.id])
    expect(result.results[0]?.matches[0]?.text).toContain("cat photo")
    expect(result.partial).toBe(false)
  })

  test("returns flagged partial matches only when no session contains every term", () => {
    const most = session("ses_most", "Most terms", [
      { role: "user", parts: [{ text: "alpha-needle and beta-needle" }] },
    ])
    const few = session("ses_few", "Few terms", [{ role: "user", parts: [{ text: "alpha-needle alone" }] }])

    const partial = run("alpha-needle beta-needle gamma-needle", [most, few])
    expect(partial.partial).toBe(true)
    expect(partial.results.map((item) => [item.id, item.missing])).toEqual([[most.id, ["gamma-needle"]]])

    const full = run("alpha-needle beta-needle", [most, few])
    expect(full.partial).toBe(false)
    expect(full.results.map((item) => [item.id, item.missing])).toEqual([[most.id, undefined]])
    expect(run("gamma-needle delta-needle", [most, few]).results).toEqual([])
  })

  test("matches typos against session titles and ranks them below exact matches", () => {
    const fuzzy = session("ses_fuzzy", "Optimize recall search")
    const exact = session("ses_exact", "recal serch literal")
    const unrelated = session("ses_unrelated", "Unrelated")

    const sessions = [unrelated, fuzzy, exact]
    expect(run("recal serch", sessions).results.map((item) => item.id)).toEqual([exact.id, fuzzy.id])
    expect(run("optimize saerch", sessions).results.map((item) => item.id)).toEqual([fuzzy.id])
    expect(run("rcall", sessions).results.map((item) => item.id)).toEqual([fuzzy.id])
    expect(run("recl", sessions).results).toEqual([])
    expect(run("optimise", sessions).results.map((item) => item.id)).toEqual([fuzzy.id])
    expect(run("optimising", sessions).results).toEqual([])
  })

  test("excludes the active user turn from search results", () => {
    const historical = session("ses_historical", "Historical", [
      { role: "user", parts: [{ text: "exclusive-recall-needle" }] },
    ])
    const active = session("ses_active", "exclusive-recall-needle", [
      { role: "user", parts: [{ text: "older unrelated turn" }] },
      { role: "user", parts: [{ text: "exclusive-recall-needle" }] },
      { role: "assistant", parts: [{ text: "exclusive-recall-needle" }] },
    ])

    const boundary = active.messages[1]!.id
    const result = RecallSearch.search({
      query: "exclusive-recall-needle",
      sessions: [historical, active],
      limit: 1,
      excludeSessionID: active.id,
      excludeFromMessageID: boundary,
    })
    expect(result.results.map((item) => item.id)).toEqual([historical.id])
  })

  test("searches references and errors", () => {
    const reference = session("ses_reference", "Reference", [
      { role: "user", parts: [{ text: "RecallSearch recall-search.ts /packages/recall.ts", kind: "file" }] },
    ])
    const error = session("ses_error", "Error", [
      { role: "assistant", parts: [{ text: "EADDRINUSE on port 4321", kind: "tool" }] },
    ])

    expect(run("RecallSearch", [reference]).results[0]?.matches[0]?.source).toBe("reference")
    expect(run("EADDRINUSE", [error]).results[0]?.matches[0]?.source).toBe("error")
  })

  test("bounds snippets around the match", () => {
    const large = session("ses_large", "Large session", [
      { role: "user", parts: [{ text: `terminal ${"x".repeat(20_000)} terminal needle ${"y".repeat(20_000)}` }] },
    ])
    const snippet = run("terminal needle", [large]).results[0]?.matches[0]?.text ?? ""
    expect(snippet).toContain("terminal needle")
    expect(snippet.length).toBeLessThan(370)
  })

  test("supports literal matching and folded wide characters", () => {
    const sessionRecord = session("ses_literal", "Literal", [
      { role: "user", parts: [{ text: "job_id reached 100%" }] },
      { role: "user", parts: [{ text: `${"x".repeat(1_000)} Compatibility ＦＯＯ marker` }] },
      { role: "user", parts: [{ text: "control\u0000byte then ＷＩＤＥ-needle" }] },
    ])
    expect(run("job_id 100%", [sessionRecord]).results.map((item) => item.id)).toEqual([sessionRecord.id])
    const compatibility = run("foo", [sessionRecord])
    expect(compatibility.results.map((item) => item.id)).toEqual([sessionRecord.id])
    expect(compatibility.results[0]?.matches[0]?.text).toContain("ＦＯＯ")
    expect(run("wide-needle", [sessionRecord]).results.map((item) => item.id)).toEqual([sessionRecord.id])
  })

  test("stops when the signal is aborted", () => {
    const controller = new AbortController()
    controller.abort(new Error("cancelled recall search"))
    expect(() => run("anything", [session("ses_abort", "Abort")], { signal: controller.signal })).toThrow(
      "cancelled recall search",
    )
  })

  test("rejects an invalid limit and an empty query", () => {
    expect(() => RecallSearch.search({ query: "x", sessions: [], limit: 0 })).toThrow(
      "Search result limits must be integers from 1 to 50",
    )
    expect(() => run("   ", [])).toThrow("The 'query' parameter is required when mode is 'search'")
  })
})
