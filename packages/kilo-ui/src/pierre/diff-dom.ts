import type { SelectedLineRange } from "@pierre/diffs"

export type DiffSide = "additions" | "deletions"

export function findDiffSide(element: HTMLElement): DiffSide {
  const line = element.closest("[data-line], [data-alt-line]")
  if (line instanceof HTMLElement) {
    const type = line.dataset.lineType
    if (type === "change-deletion") return "deletions"
    if (type === "change-addition" || type === "change-additions") return "additions"
  }

  const code = element.closest("[data-code]")
  if (!(code instanceof HTMLElement)) return "additions"
  return code.hasAttribute("data-deletions") ? "deletions" : "additions"
}

export function diffLineIndex(split: boolean, element: HTMLElement): number | undefined {
  const raw = element.dataset.lineIndex
  if (!raw) return
  const values = raw
    .split(",")
    .map((value) => parseInt(value, 10))
    .filter((value) => !Number.isNaN(value))
  if (values.length === 0) return
  if (!split) return values[0]
  if (values.length === 2) return values[1]
  return values[0]
}

export function diffRowIndex(
  root: ShadowRoot,
  split: boolean,
  line: number,
  side: DiffSide | undefined,
): number | undefined {
  const nodes = Array.from(root.querySelectorAll(`[data-line="${line}"], [data-alt-line="${line}"]`)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  if (nodes.length === 0) return

  const targetSide = side ?? "additions"
  for (const node of nodes) {
    if (findDiffSide(node) === targetSide) return diffLineIndex(split, node)
    if (parseInt(node.dataset.altLine ?? "", 10) === line) return diffLineIndex(split, node)
  }
}

export function applyDiffCommentedLines(root: ShadowRoot, ranges: SelectedLineRange[]): void {
  const existing = Array.from(root.querySelectorAll("[data-comment-selected]"))
  for (const node of existing) {
    if (!(node instanceof HTMLElement)) continue
    node.removeAttribute("data-comment-selected")
  }

  const diffs = root.querySelector("[data-diff]")
  if (!(diffs instanceof HTMLElement)) return

  const split = diffs.dataset.diffType === "split"
  const rows = Array.from(diffs.querySelectorAll("[data-line-index]")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  if (rows.length === 0) return

  const annotations = Array.from(diffs.querySelectorAll("[data-line-annotation]")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )

  for (const range of ranges) {
    const start = diffRowIndex(root, split, range.start, range.side)
    if (start === undefined) continue

    const end =
      range.end === range.start && (range.endSide == null || range.endSide === range.side)
        ? start
        : diffRowIndex(root, split, range.end, range.endSide ?? range.side)
    if (end === undefined) continue

    const first = Math.min(start, end)
    const last = Math.max(start, end)
    for (const row of rows) {
      const index = diffLineIndex(split, row)
      if (index === undefined || index < first || index > last) continue
      row.setAttribute("data-comment-selected", "")
    }

    for (const annotation of annotations) {
      const index = parseInt(annotation.dataset.lineAnnotation?.split(",")[1] ?? "", 10)
      if (Number.isNaN(index) || index < first || index > last) continue
      annotation.setAttribute("data-comment-selected", "")
    }
  }
}
