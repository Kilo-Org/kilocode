/**
 * Pure selection/footer math for the leftover-worktree-folders dialog, kept out of `OrphanDialog.tsx`
 * so it is testable without a Solid render pass.
 */
import type { OrphanDirectory } from "../project/store"

/** Selection defaults to every `leftover` row checked; `broken` rows start unchecked and flagged. */
export function defaultOrphanSelection(orphans: OrphanDirectory[]): Set<string> {
  return new Set(orphans.filter((orphan) => orphan.kind === "leftover").map((orphan) => orphan.path))
}

export interface OrphanSelectionStats {
  count: number
  /** Total apparent size of the selected rows, or undefined unless every one of them is known. */
  bytes: number | undefined
  /** True while a size pass is still expected to answer for one of the selected rows. */
  pending: boolean
  /** How many selected rows still hold a git checkout. */
  checkouts: number
}

/** Footer summary math for the current selection. */
export function orphanSelectionStats(orphans: OrphanDirectory[], selected: ReadonlySet<string>): OrphanSelectionStats {
  const rows = orphans.filter((orphan) => selected.has(orphan.path))
  const checkouts = rows.filter((orphan) => orphan.kind === "broken").length
  const bytes = rows.some((orphan) => orphan.bytes === undefined)
    ? undefined
    : rows.reduce((sum, orphan) => sum + (orphan.bytes ?? 0), 0)
  return { count: rows.length, bytes, pending: !orphanSizesSettled(rows), checkouts }
}

/** Total known size across every orphan, or undefined unless every one of them is known. */
export function orphanTotalBytes(orphans: OrphanDirectory[]): number | undefined {
  if (orphans.some((orphan) => orphan.bytes === undefined)) return undefined
  return orphans.reduce((sum, orphan) => sum + (orphan.bytes ?? 0), 0)
}

/**
 * Whether the size pass is done with every one of these folders.
 *
 * A folder the host could not walk never gets a `bytes`, so "no size yet" is not the same question as
 * "is a size still coming?" — without this the UI would offer to keep calculating indefinitely.
 */
export function orphanSizesSettled(orphans: OrphanDirectory[]): boolean {
  return orphans.every((orphan) => orphan.bytes !== undefined || orphan.sized === true)
}

/** Apparent size formatted for display, e.g. `1.2 GB`. Mirrors the host-side formatter. */
export function formatOrphanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const precision = unit === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unit]}`
}

export type RevealPlatform = "mac" | "windows" | "linux"

/** OS-family detection for the reveal button's platform-specific label. */
export function revealPlatform(userAgent: string): RevealPlatform {
  if (/Mac|iPhone|iPad/.test(userAgent)) return "mac"
  if (/Win/.test(userAgent)) return "windows"
  return "linux"
}
