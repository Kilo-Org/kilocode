import { describe, expect, test } from "bun:test"
import {
  BROWSER_CACHE_SIZE,
  browserScopeKey,
  browserScopeParts,
  evictBrowserScopes,
  rememberBrowserScope,
} from "../webview-ui/agent-manager/browser-panel-cache"

describe("browser panel cache bookkeeping", () => {
  test("keys and parts round-trip project and session", () => {
    const key = browserScopeKey("prj-1", "ses-1")
    expect(browserScopeParts(key)).toEqual({ project: "prj-1", session: "ses-1" })
    expect(browserScopeParts(browserScopeKey(undefined, "ses-2"))).toEqual({
      project: "single",
      session: "ses-2",
    })
  })

  test("remembers a scope once and evicts the least recently used entry", () => {
    const first = browserScopeKey("prj-1", "ses-1")
    const fresh = browserScopeKey("prj-1", "ses-new")
    const empty = { entries: [], recent: [] }
    expect(rememberBrowserScope(empty, first)).toEqual({ entries: [first], recent: [first] })
    const once = rememberBrowserScope(empty, first)
    expect(rememberBrowserScope(once, first)).toBe(once)
    const full = Array.from({ length: BROWSER_CACHE_SIZE }, (_, index) => browserScopeKey("prj-1", `ses-${index}`))
    // ses-0 was used last, so ses-1 is the least recently used entry.
    const used = rememberBrowserScope({ entries: full, recent: [...full.slice(1), full[0]!] }, fresh)
    expect(used.entries).toEqual([full[0]!, ...full.slice(2), fresh])
    expect(used.recent.at(-1)).toBe(fresh)
  })

  test("keeps the render order when a known scope is used again", () => {
    const a = browserScopeKey("prj-1", "ses-a")
    const b = browserScopeKey("prj-1", "ses-b")
    const next = rememberBrowserScope({ entries: [a, b], recent: [a, b] }, a)
    expect(next.entries).toEqual([a, b])
    expect(next.recent).toEqual([b, a])
  })

  test("retires missing sessions only within the active project", () => {
    const kept = browserScopeKey("prj-1", "ses-keep")
    const gone = browserScopeKey("prj-1", "ses-gone")
    const other = browserScopeKey("prj-2", "ses-other")
    const scopes = { entries: [kept, gone, other], recent: [other, gone, kept] }
    expect(evictBrowserScopes(scopes, new Set(["ses-keep"]), "prj-1", kept)).toEqual({
      entries: [kept, other],
      recent: [other, kept],
    })
    expect(evictBrowserScopes(scopes, new Set(), "prj-1", gone).entries).toEqual([gone, other])
    expect(evictBrowserScopes(scopes, new Set(), "prj-2").entries).toEqual([kept, gone])
  })
})
