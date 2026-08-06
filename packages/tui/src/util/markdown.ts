// kilocode_change - new file

/**
 * Formats markdown tables with fixed-width columns, similar to VS Code's behavior.
 * This normalizes column widths so tables render with aligned columns.
 */

type TableRow = string[]

interface Table {
  startIndex: number
  endIndex: number
  rows: TableRow[]
  alignments: ("left" | "center" | "right" | "none")[]
}

/**
 * Parses a single table row, splitting by | and trimming cells
 */
function parseRow(line: string): TableRow | null {
  // Must start and end with | (after trimming)
  const trimmed = line.trim()
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null

  // Split by | and remove first/last empty elements
  const cells = trimmed.split("|").slice(1, -1)
  return cells.map((cell) => cell.trim())
}

/**
 * Checks if a row is a separator row (contains only dashes, colons, and spaces)
 */
function isSeparatorRow(cells: TableRow): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell))
}

/**
 * Extracts alignment from separator row cells
 */
function getAlignment(cell: string): "left" | "center" | "right" | "none" {
  const left = cell.startsWith(":")
  const right = cell.endsWith(":")
  if (left && right) return "center"
  if (right) return "right"
  if (left) return "left"
  return "none"
}

/**
 * Gets the display width of a string, accounting for wide characters
 */
function getDisplayWidth(str: string): number {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0)!
    // Check for wide characters (CJK, etc.)
    if (
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x9fff) || // CJK
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xfe10 && code <= 0xfe1f) || // Vertical forms
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
      (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
      (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth symbols
      (code >= 0x20000 && code <= 0x2fffd) || // CJK Extension B-F
      (code >= 0x30000 && code <= 0x3fffd) // CJK Extension G
    ) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

/**
 * Pads a string to a target display width
 */
function padToWidth(str: string, width: number, align: "left" | "center" | "right" | "none"): string {
  const currentWidth = getDisplayWidth(str)
  const padding = width - currentWidth
  if (padding <= 0) return str

  switch (align) {
    case "center": {
      const left = Math.floor(padding / 2)
      const right = padding - left
      return " ".repeat(left) + str + " ".repeat(right)
    }
    case "right":
      return " ".repeat(padding) + str
    default:
      return str + " ".repeat(padding)
  }
}

/**
 * Finds all markdown tables in the content
 */
function findTables(lines: string[]): Table[] {
  const tables: Table[] = []
  let i = 0

  while (i < lines.length) {
    // Try to parse as table row
    const headerCells = parseRow(lines[i])
    if (!headerCells || headerCells.length === 0) {
      i++
      continue
    }

    // Check if next line is separator
    if (i + 1 >= lines.length) {
      i++
      continue
    }

    const separatorCells = parseRow(lines[i + 1])
    if (!separatorCells || !isSeparatorRow(separatorCells)) {
      i++
      continue
    }

    // Found a table! Parse all rows
    const table: Table = {
      startIndex: i,
      endIndex: i + 1,
      rows: [headerCells, separatorCells],
      alignments: separatorCells.map(getAlignment),
    }

    // Continue parsing data rows
    let j = i + 2
    while (j < lines.length) {
      const rowCells = parseRow(lines[j])
      if (!rowCells) break
      table.rows.push(rowCells)
      table.endIndex = j
      j++
    }

    tables.push(table)
    i = j
  }

  return tables
}

/**
 * Formats a table with fixed-width columns
 */
function formatTable(table: Table): string[] {
  const columnCount = Math.max(...table.rows.map((row) => row.length))

  // Calculate max width for each column
  const columnWidths: number[] = Array(columnCount).fill(0)

  for (const row of table.rows) {
    for (let col = 0; col < columnCount; col++) {
      const cell = row[col] ?? ""
      // For separator rows, we use a minimum width of 3 (---)
      if (isSeparatorRow(row)) {
        columnWidths[col] = Math.max(columnWidths[col], 3)
      } else {
        columnWidths[col] = Math.max(columnWidths[col], getDisplayWidth(cell))
      }
    }
  }

  // Format each row
  return table.rows.map((row, rowIndex) => {
    const cells: string[] = []
    for (let col = 0; col < columnCount; col++) {
      const cell = row[col] ?? ""
      const width = columnWidths[col]
      const align = table.alignments[col] ?? "none"

      if (rowIndex === 1) {
        // Separator row - create dashes to match column width
        const hasLeft = align === "left" || align === "center"
        const hasRight = align === "right" || align === "center"
        const dashCount = width - (hasLeft ? 1 : 0) - (hasRight ? 1 : 0)
        const dashes = "-".repeat(Math.max(dashCount, 1))
        cells.push((hasLeft ? ":" : "") + dashes + (hasRight ? ":" : ""))
      } else {
        cells.push(padToWidth(cell, width, align))
      }
    }
    return "| " + cells.join(" | ") + " |"
  })
}

/**
 * Formats all markdown tables in the content with fixed-width columns.
 * Tables that don't follow standard markdown table syntax are left unchanged.
 */
export function formatMarkdownTables(content: string): string {
  const lines = content.split("\n")
  const tables = findTables(lines)

  if (tables.length === 0) return content

  // Process tables in reverse order to maintain correct indices
  for (let i = tables.length - 1; i >= 0; i--) {
    const table = tables[i]
    const formatted = formatTable(table)
    lines.splice(table.startIndex, table.endIndex - table.startIndex + 1, ...formatted)
  }

  return lines.join("\n")
}
