import {
  DEFAULT_EDITABLE_REGION_BOTTOM_MARGIN,
  DEFAULT_EDITABLE_REGION_TOP_MARGIN,
  MAX_EDITABLE_REGION_LINES,
} from "./constants"

export interface EditableRegionInputs {
  cursorLine: number
  totalLines: number
  topMargin?: number
  bottomMargin?: number
}

export interface EditableRegion {
  startLine: number
  endLine: number
}

/**
 * Editable region selection per the Mercury docs: center [-top, +bottom] around
 * the cursor, clipped to file bounds. Capped to MAX_EDITABLE_REGION_LINES (~25)
 * because output tokens dominate latency.
 */
export function computeEditableRegion({
  cursorLine,
  totalLines,
  topMargin = DEFAULT_EDITABLE_REGION_TOP_MARGIN,
  bottomMargin = DEFAULT_EDITABLE_REGION_BOTTOM_MARGIN,
}: EditableRegionInputs): EditableRegion {
  if (totalLines <= 0) return { startLine: 0, endLine: 0 }

  const lastLine = totalLines - 1
  let start = Math.max(0, cursorLine - topMargin)
  let end = Math.min(lastLine, cursorLine + bottomMargin)

  const span = end - start + 1
  if (span > MAX_EDITABLE_REGION_LINES) {
    const overflow = span - MAX_EDITABLE_REGION_LINES
    // Prefer trimming below the cursor, where we have less semantic context.
    end = Math.max(start, end - overflow)
  }
  return { startLine: start, endLine: end }
}
