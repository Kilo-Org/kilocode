import type { SelectedLineRange } from "@pierre/diffs"

type Side = "additions" | "deletions"

export function fixDiffSelection(
  root: ShadowRoot,
  range: SelectedLineRange | null,
  row: (root: ShadowRoot, split: boolean, line: number, side: Side | undefined) => number | undefined,
): SelectedLineRange | null | undefined {
  if (!range) return range
  const diffs = root.querySelector("[data-diff]")
  if (!(diffs instanceof HTMLElement)) return

  const split = diffs.dataset.diffType === "split"
  const start = row(root, split, range.start, range.side)
  const end = row(root, split, range.end, range.endSide ?? range.side)
  if (start === undefined || end === undefined) {
    if (root.querySelector("[data-line], [data-alt-line]") == null) return
    return null
  }
  if (start <= end) return range

  const side = range.endSide ?? range.side
  const swapped: SelectedLineRange = { start: range.end, end: range.start }
  if (side) swapped.side = side
  if (range.endSide && range.side) swapped.endSide = range.side
  return swapped
}
