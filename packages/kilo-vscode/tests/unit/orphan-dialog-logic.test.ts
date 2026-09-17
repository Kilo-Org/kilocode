/**
 * Pure-logic tests for the leftover-worktree-folders dialog's selection and footer math.
 *
 * No webview `.tsx` test harness exists in this package (see `tests/unit/` conventions — component
 * rendering is covered by Playwright visual-regression specs, not this Bun unit runner), so
 * `OrphanDialog.tsx`'s selection defaults and footer math were extracted into a plain module and are
 * exercised directly here instead.
 */
import { describe, expect, it } from "bun:test"
import {
  defaultOrphanSelection,
  formatOrphanBytes,
  orphanSelectionStats,
  orphanSizesSettled,
  orphanTotalBytes,
  revealPlatform,
} from "../../webview-ui/agent-manager/orphan-dialog-logic"
import type { OrphanDirectory } from "../../webview-ui/agent-manager/project/store"

describe("defaultOrphanSelection", () => {
  it("checks every leftover row and leaves broken rows unchecked", () => {
    const orphans: OrphanDirectory[] = [
      { path: "/a", kind: "leftover" },
      { path: "/b", kind: "broken" },
      { path: "/c", kind: "leftover" },
    ]

    expect(defaultOrphanSelection(orphans)).toEqual(new Set(["/a", "/c"]))
  })
})

describe("orphanSelectionStats", () => {
  it("counts selected rows, sums their size, and counts selected checkouts", () => {
    const orphans: OrphanDirectory[] = [
      { path: "/a", kind: "leftover", bytes: 100 },
      { path: "/b", kind: "broken", bytes: 50 },
      { path: "/c", kind: "leftover", bytes: 25 },
    ]

    const stats = orphanSelectionStats(orphans, new Set(["/a", "/b"]))

    expect(stats).toEqual({ count: 2, bytes: 150, pending: false, checkouts: 1 })
  })

  it("reports an unknown total while any selected row's size is still pending", () => {
    const orphans: OrphanDirectory[] = [
      { path: "/a", kind: "leftover", bytes: 100 },
      { path: "/b", kind: "leftover" },
    ]

    const stats = orphanSelectionStats(orphans, new Set(["/a", "/b"]))

    expect(stats.bytes).toBeUndefined()
    expect(stats.count).toBe(2)
    expect(stats.pending).toBe(true)
  })

  it("stops reporting pending once a row the host could not measure has settled", () => {
    const orphans: OrphanDirectory[] = [
      { path: "/a", kind: "leftover", bytes: 100 },
      // Walked, but unreadable: no size is ever coming for this one.
      { path: "/b", kind: "leftover", sized: true },
    ]

    const stats = orphanSelectionStats(orphans, new Set(["/a", "/b"]))

    expect(stats.bytes, "an incomplete total must not be presented as the size").toBeUndefined()
    expect(stats.pending, "the footer must stop claiming it is calculating").toBe(false)
  })

  it("returns zeroes for an empty selection", () => {
    const orphans: OrphanDirectory[] = [{ path: "/a", kind: "leftover", bytes: 10 }]

    expect(orphanSelectionStats(orphans, new Set())).toEqual({
      count: 0,
      bytes: 0,
      pending: false,
      checkouts: 0,
    })
  })
})

describe("orphanSizesSettled", () => {
  it("is false while a pass is still expected to answer", () => {
    expect(orphanSizesSettled([{ path: "/a", kind: "leftover" }])).toBe(false)
  })

  it("is true once every folder has a size", () => {
    expect(orphanSizesSettled([{ path: "/a", kind: "leftover", bytes: 10 }])).toBe(true)
  })

  it("is true for a folder that was walked but could not be measured", () => {
    expect(orphanSizesSettled([{ path: "/a", kind: "leftover", sized: true }])).toBe(true)
  })
})

describe("orphanTotalBytes", () => {
  it("sums every orphan's size once all are known", () => {
    const orphans: OrphanDirectory[] = [
      { path: "/a", kind: "leftover", bytes: 100 },
      { path: "/b", kind: "broken", bytes: 200 },
    ]

    expect(orphanTotalBytes(orphans)).toBe(300)
  })

  it("is undefined while any size is still pending", () => {
    const orphans: OrphanDirectory[] = [{ path: "/a", kind: "leftover" }]

    expect(orphanTotalBytes(orphans)).toBeUndefined()
  })
})

describe("formatOrphanBytes", () => {
  it("formats bytes below 1 KB with no decimal", () => {
    expect(formatOrphanBytes(512)).toBe("512 B")
  })

  it("formats larger sizes with one decimal and the right unit", () => {
    expect(formatOrphanBytes(1536)).toBe("1.5 KB")
    expect(formatOrphanBytes(1_288_490_188.8)).toBe("1.2 GB")
  })
})

describe("revealPlatform", () => {
  it("detects mac from the user agent", () => {
    expect(revealPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac")
  })

  it("detects windows from the user agent", () => {
    expect(revealPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows")
  })

  it("falls back to linux for anything else", () => {
    expect(revealPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux")
  })
})
