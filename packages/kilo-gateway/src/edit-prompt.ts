/**
 * Mercury Next Edit prompt assembly. Lives in the gateway so every client
 * (VS Code, JetBrains, TUI) sends the same structured editor context and the
 * Mercury-specific sentinel format is defined in exactly one place.
 *
 * Tag set is defined by the model and must be reproduced verbatim — see
 * https://docs.inceptionlabs.ai/capabilities/next-edit
 */

const RECENTLY_VIEWED_SNIPPETS_OPEN = "<|recently_viewed_code_snippets|>"
const RECENTLY_VIEWED_SNIPPETS_CLOSE = "<|/recently_viewed_code_snippets|>"
const RECENTLY_VIEWED_SNIPPET_OPEN = "<|recently_viewed_code_snippet|>"
const RECENTLY_VIEWED_SNIPPET_CLOSE = "<|/recently_viewed_code_snippet|>"
const CURRENT_FILE_CONTENT_OPEN = "<|current_file_content|>"
const CURRENT_FILE_CONTENT_CLOSE = "<|/current_file_content|>"
const CODE_TO_EDIT_OPEN = "<|code_to_edit|>"
const CODE_TO_EDIT_CLOSE = "<|/code_to_edit|>"
const EDIT_DIFF_HISTORY_OPEN = "<|edit_diff_history|>"
const EDIT_DIFF_HISTORY_CLOSE = "<|/edit_diff_history|>"
const CURSOR = "<|cursor|>"
/** Trailing token that tells the model this is a next-edit (not chat) request. */
const UNIQUE_TOKEN = "<|!@#IS_NEXT_EDIT!@#|>"

export interface MercuryRecentSnippet {
  filepath: string
  content: string
}

/** Editor-derived context a client sends; the gateway turns it into a prompt. */
export interface MercuryEditContext {
  currentFilePath: string
  currentFileContent: string
  cursorLine: number
  cursorCharacter: number
  editableRegionStartLine: number
  editableRegionEndLine: number
  recentlyViewedSnippets: MercuryRecentSnippet[]
  editDiffHistory: string[]
}

function insertCursorToken(lines: string[], cursorLine: number, cursorCharacter: number): string[] {
  if (cursorLine < 0 || cursorLine >= lines.length) return lines
  const line = lines[cursorLine]
  const safeChar = Math.min(Math.max(cursorCharacter, 0), line.length)
  const next = line.slice(0, safeChar) + CURSOR + line.slice(safeChar)
  return [...lines.slice(0, cursorLine), next, ...lines.slice(cursorLine + 1)]
}

export function recentlyViewedSnippetsBlock(snippets: MercuryRecentSnippet[]): string {
  const inner = snippets
    .map((s) =>
      [
        RECENTLY_VIEWED_SNIPPET_OPEN,
        `code_snippet_file_path: ${s.filepath}`,
        s.content,
        RECENTLY_VIEWED_SNIPPET_CLOSE,
      ].join("\n"),
    )
    .join("\n")
  return [RECENTLY_VIEWED_SNIPPETS_OPEN, inner, RECENTLY_VIEWED_SNIPPETS_CLOSE].join("\n")
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
    CODE_TO_EDIT_OPEN,
    ...withCursor.slice(start, end + 1),
    CODE_TO_EDIT_CLOSE,
    ...withCursor.slice(end + 1),
  ]
  return [
    CURRENT_FILE_CONTENT_OPEN,
    `current_file_path: ${currentFilePath}`,
    instrumented.join("\n"),
    CURRENT_FILE_CONTENT_CLOSE,
  ].join("\n")
}

export function editDiffHistoryBlock(diffs: string[]): string {
  // Each unidiff from `diff.createPatch` opens with an Index line + separator we
  // strip. Diffs are blank-line separated so the model reads them as distinct hunks.
  const trimmed = diffs.map((d) => {
    const lines = d.split("\n")
    return lines.length > 2 ? lines.slice(2).join("\n") : d
  })
  return [EDIT_DIFF_HISTORY_OPEN, trimmed.join("\n\n"), EDIT_DIFF_HISTORY_CLOSE].join("\n")
}

export function buildMercuryEditPrompt(ctx: MercuryEditContext): string {
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
    UNIQUE_TOKEN,
  ].join("\n")
}
