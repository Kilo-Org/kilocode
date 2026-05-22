import {
  MERCURY_CODE_TO_EDIT_CLOSE,
  MERCURY_CODE_TO_EDIT_OPEN,
  MERCURY_CURRENT_FILE_CONTENT_CLOSE,
  MERCURY_CURRENT_FILE_CONTENT_OPEN,
  MERCURY_CURSOR,
  MERCURY_EDIT_DIFF_HISTORY_CLOSE,
  MERCURY_EDIT_DIFF_HISTORY_OPEN,
  MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE,
  MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN,
  MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_CLOSE,
  MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_OPEN,
  MERCURY_UNIQUE_TOKEN,
} from "./constants"
import type { MercuryEditRequestContext, MercuryRecentSnippet } from "./types"

function insertCursorToken(lines: string[], cursorLine: number, cursorCharacter: number): string[] {
  if (cursorLine < 0 || cursorLine >= lines.length) return lines
  const line = lines[cursorLine]
  const safeChar = Math.min(Math.max(cursorCharacter, 0), line.length)
  const next = line.slice(0, safeChar) + MERCURY_CURSOR + line.slice(safeChar)
  return [...lines.slice(0, cursorLine), next, ...lines.slice(cursorLine + 1)]
}

export function recentlyViewedSnippetsBlock(snippets: MercuryRecentSnippet[]): string {
  const inner = snippets
    .map((s) =>
      [
        MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_OPEN,
        `code_snippet_file_path: ${s.filepath}`,
        s.content,
        MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_CLOSE,
      ].join("\n"),
    )
    .join("\n")
  return [MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN, inner, MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE].join("\n")
}

export function currentFileContentBlock(
  currentFilePath: string,
  currentFileContent: string,
  editableRegionStartLine: number,
  editableRegionEndLine: number,
  cursorLine: number,
  cursorCharacter: number,
): string {
  const rawLines = currentFileContent.split("\n")
  const withCursor = insertCursorToken(rawLines, cursorLine, cursorCharacter)
  const start = Math.max(0, Math.min(editableRegionStartLine, withCursor.length))
  const end = Math.max(start, Math.min(editableRegionEndLine, withCursor.length - 1))
  const instrumented = [
    ...withCursor.slice(0, start),
    MERCURY_CODE_TO_EDIT_OPEN,
    ...withCursor.slice(start, end + 1),
    MERCURY_CODE_TO_EDIT_CLOSE,
    ...withCursor.slice(end + 1),
  ]
  return [
    MERCURY_CURRENT_FILE_CONTENT_OPEN,
    `current_file_path: ${currentFilePath}`,
    instrumented.join("\n"),
    MERCURY_CURRENT_FILE_CONTENT_CLOSE,
  ].join("\n")
}

export function editDiffHistoryBlock(diffs: string[]): string {
  // Each unidiff from `diff.createPatch` starts with an Index line and a
  // separator we strip — matches the POC's editHistoryBlock. Diffs are
  // separated by a blank line so the model parses them as distinct hunks.
  const trimmed = diffs.map((d) => {
    const lines = d.split("\n")
    return lines.length > 2 ? lines.slice(2).join("\n") : d
  })
  return [MERCURY_EDIT_DIFF_HISTORY_OPEN, trimmed.join("\n\n"), MERCURY_EDIT_DIFF_HISTORY_CLOSE].join("\n")
}

export function buildMercuryEditPrompt(ctx: MercuryEditRequestContext): string {
  // Trailing unique token signals "this is a next-edit request" to the model.
  return [
    recentlyViewedSnippetsBlock(ctx.recentlyViewedSnippets),
    "",
    currentFileContentBlock(
      ctx.currentFilePath,
      ctx.currentFileContent,
      ctx.editableRegionStartLine,
      ctx.editableRegionEndLine,
      ctx.cursorLine,
      ctx.cursorCharacter,
    ),
    "",
    editDiffHistoryBlock(ctx.editDiffHistory),
    "",
    MERCURY_UNIQUE_TOKEN,
  ].join("\n")
}
