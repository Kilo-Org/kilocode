import { describe, expect, test } from "bun:test"
import {
  BROWSER_CACHE_SIZE,
  browserScopeKey,
  browserScopeParts,
  evictBrowserScopes,
  rememberBrowserScope,
} from "../../webview-ui/agent-manager/browser-panel-cache"

describe("browser panel cache bookkeeping", () => {
  test("keys and parts round-trip project and session", () => {
    const key = browserScopeKey("prj-1", "ses-1")
    expect(browserScopeParts(key)).toEqual({ project: "prj-1", session: "ses-1" })
    expect(browserScopeParts(browserScopeKey(undefined, "ses-2"))).toEqual({
      project: "single",
      session: "ses-2",
    })
  })

  test("remembers a scope once and keeps the most recent entries", () => {
    const first = browserScopeKey("prj-1", "ses-1")
    const fresh = browserScopeKey("prj-1", "ses-new")
    expect(rememberBrowserScope([], first)).toEqual([first])
    expect(rememberBrowserScope([first], first)).toEqual([first])
    const full = Array.from({ length: BROWSER_CACHE_SIZE }, (_, index) => browserScopeKey("prj-1", `ses-${index}`))
    const next = rememberBrowserScope(full, fresh)
    expect(next.length).toBe(BROWSER_CACHE_SIZE)
    expect(next.at(-1)).toBe(fresh)
    expect(next.includes(full[0]!)).toBe(false)
  })

  test("retires missing sessions only within the active project", () => {
    const kept = browserScopeKey("prj-1", "ses-keep")
    const gone = browserScopeKey("prj-1", "ses-gone")
    const other = browserScopeKey("prj-2", "ses-other")
    const entries = [kept, gone, other]
    expect(evictBrowserScopes(entries, new Set(["ses-keep"]), "prj-1", kept)).toEqual([kept, other])
    expect(evictBrowserScopes(entries, new Set(), "prj-1", gone)).toEqual([gone, other])
    expect(evictBrowserScopes(entries, new Set(), "prj-2")).toEqual([kept, gone])
  })
})
