import * as vscode from "vscode"
import type { KiloConnectionService } from "../../cli-backend"
import { computeEditableRegion } from "./editableRegion"
import { EditHistoryTracker } from "./editHistoryTracker"
import { nesLog } from "./log"
import { MercuryEditError, MercuryEditProvider } from "./MercuryEditProvider"
import type { NextEditSuggestionManager } from "./NextEditSuggestionManager"
import type { MercuryEditRequestContext, MercuryRecentSnippet } from "./types"

const INLINE_COMPLETION_ACCEPTED_COMMAND = "kilo-code.new.autocomplete.nextEdit.accepted"
const DEFAULT_DEBOUNCE_MS = 250

export interface NextEditProviderDeps {
  /** Routes Mercury calls through the local Kilo gateway (handles auth + BYOK). */
  connectionService: KiloConnectionService
  /** Optional source of recently-viewed snippets (kilocode's VisibleCodeTracker can adapt to this). */
  getRecentlyViewedSnippets?: (document: vscode.TextDocument) => MercuryRecentSnippet[]
  /** Returns false for files that must not be sent to a server (.env etc). */
  isFileAllowed: (fsPath: string) => Promise<boolean>
  /** Telemetry hook fired on every suggestion result. */
  onSuggestion?: (event: NextEditSuggestionEvent) => void
  onFatalError?: (status: number | null) => void
  /** Stash for diffs that don't land on the cursor's line — rendered as a jump affordance. */
  suggestionManager?: NextEditSuggestionManager
  /** Resolves the currently selected (provider, model) at request time. */
  getModelSelection?: () => { providerId: string; modelId: string }
}

export interface NextEditSuggestionEvent {
  shown: boolean
  latencyMs: number
  status: "ok" | "no-replacement" | "error"
  errorStatus?: number
  inputTokens?: number
  outputTokens?: number
}

/** A parsed Mercury suggestion plus the editable region it targets. */
type SuggestionResult = {
  replacement: string
  editableRegionStartLine: number
  editableRegionEndLine: number
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
}

export class NextEditInlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly editHistoryTracker: EditHistoryTracker
  private debounceTimer: NodeJS.Timeout | null = null
  private currentAbort: AbortController | null = null

  constructor(private readonly deps: NextEditProviderDeps) {
    this.editHistoryTracker = new EditHistoryTracker({ isFileAllowed: deps.isFileAllowed })
  }

  dispose(): void {
    this.editHistoryTracker.dispose()
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.currentAbort?.abort()
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    if (document.uri.scheme !== "file") return undefined
    if (this.deps.suggestionManager?.isPending()) return undefined

    // Never send a file unless the access policy explicitly approves it.
    if (!(await this.allowed(document.uri.fsPath))) return undefined

    const isExplicit = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke
    if (!isExplicit) {
      await this.debounce(DEFAULT_DEBOUNCE_MS, token)
      if (token.isCancellationRequested) return undefined
    }

    const abort = this.swapAbortController(token)
    const ctx = await this.buildRequestContext(document, position)
    const sel = this.deps.getModelSelection?.()
    const provider = new MercuryEditProvider({
      connectionService: this.deps.connectionService,
      providerId: sel?.providerId,
      modelId: sel?.modelId,
      signal: abort.signal,
    })

    try {
      const suggestion = await provider.suggest(ctx)
      if (!suggestion || token.isCancellationRequested) {
        this.deps.onSuggestion?.({ shown: false, latencyMs: 0, status: "no-replacement" })
        return undefined
      }
      return this.toCompletionItems(document, position, suggestion)
    } catch (err) {
      return this.handleError(err)
    }
  }

  private async allowed(path: string): Promise<boolean> {
    const allow = this.deps.isFileAllowed
    if (!allow) return false
    return allow(path).catch(() => false)
  }

  private swapAbortController(token: vscode.CancellationToken): AbortController {
    this.currentAbort?.abort()
    const abort = new AbortController()
    this.currentAbort = abort
    token.onCancellationRequested(() => abort.abort())
    return abort
  }

  private async buildRequestContext(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<MercuryEditRequestContext> {
    const { startLine, endLine } = computeEditableRegion({
      cursorLine: position.line,
      totalLines: document.lineCount,
    })
    await this.editHistoryTracker.flush(document)
    return {
      // Mirror classic autocomplete's policy: never send an absolute fsPath upstream.
      // Mercury only needs the path for language/context hints, and the workspace-relative
      // form is what `recentlyViewedSnippets` already uses (see recentSnippetsAdapter.ts).
      currentFilePath: vscode.workspace.asRelativePath(document.uri, false),
      currentFileContent: document.getText(),
      cursorLine: position.line,
      cursorCharacter: position.character,
      editableRegionStartLine: startLine,
      editableRegionEndLine: endLine,
      recentlyViewedSnippets: this.deps.getRecentlyViewedSnippets?.(document) ?? [],
      editDiffHistory: await this.editHistoryTracker.getRecentDiffs(),
    }
  }

  private toCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    suggestion: SuggestionResult,
  ): vscode.InlineCompletionItem[] | undefined {
    const endLine = Math.min(suggestion.editableRegionEndLine, document.lineCount - 1)
    const fullRange = new vscode.Range(
      new vscode.Position(suggestion.editableRegionStartLine, 0),
      document.lineAt(endLine).range.end,
    )
    const currentText = document.getText(fullRange)
    if (currentText === suggestion.replacement) {
      this.emitNotShown(suggestion)
      return undefined
    }

    // Trim to minimal diff: skip identical leading and trailing lines.
    const currentLines = currentText.split("\n")
    const proposedLines = suggestion.replacement.split("\n")
    let prefixLines = 0
    while (
      prefixLines < currentLines.length &&
      prefixLines < proposedLines.length &&
      currentLines[prefixLines] === proposedLines[prefixLines]
    )
      prefixLines++
    let suffixLines = 0
    while (
      suffixLines < currentLines.length - prefixLines &&
      suffixLines < proposedLines.length - prefixLines &&
      currentLines[currentLines.length - 1 - suffixLines] === proposedLines[proposedLines.length - 1 - suffixLines]
    )
      suffixLines++

    const diffStartLineInFile = suggestion.editableRegionStartLine + prefixLines
    const diffEndLineInFile = suggestion.editableRegionStartLine + currentLines.length - 1 - suffixLines
    const trimmedLines = proposedLines.slice(prefixLines, proposedLines.length - suffixLines)
    const trimmedReplacement = trimmedLines.join("\n")

    nesLog(
      `diff at lines [${diffStartLineInFile}..${diffEndLineInFile}], cursor at line ${position.line}, ${trimmedReplacement.length} chars`,
    )

    // VSCode's inline ghost text only renders when the diff starts on the cursor's line.
    // For off-cursor diffs, stash the suggestion in the manager — it renders a
    // decoration-based "jump to next edit" affordance and Tab handles the move/apply.
    const isPureInsertion = diffEndLineInFile < diffStartLineInFile
    const removesLines = trimmedLines.length === 0
    if (isPureInsertion || removesLines || diffStartLineInFile !== position.line) {
      this.stashOffCursorSuggestion(
        document,
        diffStartLineInFile,
        diffEndLineInFile,
        trimmedReplacement,
        isPureInsertion,
        removesLines,
        suggestion,
      )
      return undefined
    }
    // Same-line diff: clear any prior off-cursor pending state so we don't render
    // two competing affordances.
    this.deps.suggestionManager?.clear()
    return this.renderSameLineItem(
      document,
      position,
      proposedLines,
      prefixLines,
      suffixLines,
      diffStartLineInFile,
      diffEndLineInFile,
      trimmedReplacement,
      suggestion,
    )
  }

  /** Build the cursor-position ghost-text item for a same-line diff. */
  private renderSameLineItem(
    document: vscode.TextDocument,
    position: vscode.Position,
    proposedLines: string[],
    prefixLines: number,
    suffixLines: number,
    diffStartLine: number,
    diffEndLine: number,
    trimmedReplacement: string,
    suggestion: SuggestionResult,
  ): vscode.InlineCompletionItem[] | undefined {
    const cursorLineText = document.lineAt(position.line).text
    const cursorLineCurrent = cursorLineText.slice(position.character)
    const cursorLineProposed = proposedLines[prefixLines]
    // A pure deletion at the trim seam has no cursor-line replacement to render.
    if (cursorLineProposed === undefined) {
      this.emitNotShown(suggestion)
      return undefined
    }
    // Native ghost text cannot alter text before the cursor; present that edit
    // through the decoration/apply flow rather than silently discarding it.
    if (!cursorLineProposed.startsWith(cursorLineText.slice(0, position.character))) {
      this.stashOffCursorSuggestion(document, diffStartLine, diffEndLine, trimmedReplacement, false, false, suggestion)
      return undefined
    }
    const insertText = [
      cursorLineProposed.slice(position.character),
      ...proposedLines.slice(prefixLines + 1, proposedLines.length - suffixLines),
    ].join("\n")
    const renderEndLine = pickRenderEndLine(document, position.line, diffEndLine, insertText)
    // A single-line insert spanning non-blank lines below the cursor can't be
    // represented as inline ghost text — route it to the decoration path.
    if (renderEndLine > position.line && !insertText.includes("\n")) {
      this.stashOffCursorSuggestion(document, diffStartLine, diffEndLine, trimmedReplacement, false, false, suggestion)
      return undefined
    }
    const renderRange = new vscode.Range(
      position,
      new vscode.Position(renderEndLine, document.lineAt(renderEndLine).range.end.character),
    )
    if (document.getText(renderRange) === cursorLineCurrent && cursorLineCurrent === insertText) return undefined

    const item = new vscode.InlineCompletionItem(insertText, renderRange, {
      command: INLINE_COMPLETION_ACCEPTED_COMMAND,
      title: "Next Edit Accepted",
    })
    nesLog(
      `RENDER range=[${renderRange.start.line}:${renderRange.start.character}..${renderRange.end.line}:${renderRange.end.character}] insertChars=${insertText.length}`,
    )
    this.deps.onSuggestion?.({
      shown: true,
      latencyMs: suggestion.latencyMs,
      status: "ok",
      inputTokens: suggestion.inputTokens,
      outputTokens: suggestion.outputTokens,
    })
    return [item]
  }

  private emitNotShown(suggestion: SuggestionResult): void {
    this.deps.onSuggestion?.({
      shown: false,
      latencyMs: suggestion.latencyMs,
      status: "no-replacement",
      inputTokens: suggestion.inputTokens,
      outputTokens: suggestion.outputTokens,
    })
  }

  private stashOffCursorSuggestion(
    document: vscode.TextDocument,
    diffStartLine: number,
    diffEndLine: number,
    trimmedReplacement: string,
    isPureInsertion: boolean,
    removesLines: boolean,
    suggestion: SuggestionResult,
  ): void {
    const mgr = this.deps.suggestionManager
    if (!mgr) {
      // Manager wasn't wired — fall through silently. The classic path
      // already covers same-line completions; this branch only matters in
      // tests or misconfigured embeds.
      this.emitNotShown(suggestion)
      return
    }
    if (isPureInsertion) {
      // The original text we snapshot must come from the line VSCode will see
      // when the user later accepts. For mid-file inserts that's `diffStartLine`
      // (the line that gets pushed down). For EOF inserts (diffStartLine ===
      // lineCount) there is no such line; fall back to lineCount-1 (the last
      // line, which will sit just above the inserted content). The
      // SuggestionManager's drift guard knows to compare against this anchor.
      const isEof = diffStartLine >= document.lineCount
      const anchorLine = isEof
        ? Math.max(0, document.lineCount - 1)
        : Math.max(0, Math.min(diffStartLine, document.lineCount - 1))
      mgr.setPending({
        kind: "insert",
        document,
        diffStartLine,
        diffEndLine: diffStartLine,
        replacement: trimmedReplacement + "\n",
        originalText: document.lineAt(anchorLine).text,
      })
      nesLog(
        `insert suggestion stashed at line ${diffStartLine} (anchor=${anchorLine}, eof=${isEof}, ${trimmedReplacement.length} chars)`,
      )
    } else {
      const originalRange = new vscode.Range(
        new vscode.Position(diffStartLine, 0),
        new vscode.Position(diffEndLine, document.lineAt(diffEndLine).range.end.character),
      )
      mgr.setPending({
        kind: "replace",
        document,
        diffStartLine,
        diffEndLine,
        replacement: trimmedReplacement,
        removesLines,
        originalText: document.getText(originalRange),
      })
      nesLog(`replace suggestion stashed at lines [${diffStartLine}..${diffEndLine}]`)
    }
    this.deps.onSuggestion?.({
      shown: true,
      latencyMs: suggestion.latencyMs,
      status: "ok",
      inputTokens: suggestion.inputTokens,
      outputTokens: suggestion.outputTokens,
    })
  }

  private handleError(err: unknown): undefined {
    if ((err as Error)?.name === "AbortError") return undefined
    const status = err instanceof MercuryEditError ? err.status : null
    this.deps.onSuggestion?.({
      shown: false,
      latencyMs: 0,
      status: "error",
      errorStatus: status ?? undefined,
    })
    if (status === 401 || status === 402) this.deps.onFatalError?.(status)
    return undefined
  }

  private debounce(ms: number, token: vscode.CancellationToken): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    return new Promise<void>((resolve) => {
      this.debounceTimer = setTimeout(resolve, ms)
      token.onCancellationRequested(() => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        resolve()
      })
    })
  }
}

export { INLINE_COMPLETION_ACCEPTED_COMMAND }

/**
 * VSCode's inline ghost text silently fails to render when the completion's
 * range crosses a line boundary but the insert text has no newline (typical
 * when Mercury implicitly drops a trailing blank line as file-end
 * normalization). When that happens — and the lines past the cursor are
 * blank — cap the range at the cursor's line so the ghost renders cleanly.
 */
function pickRenderEndLine(
  document: vscode.TextDocument,
  cursorLine: number,
  diffEndLine: number,
  insertText: string,
): number {
  if (diffEndLine <= cursorLine) return diffEndLine
  if (insertText.includes("\n")) return diffEndLine
  for (let l = cursorLine + 1; l <= diffEndLine; l++) {
    if (document.lineAt(l).text.trim() !== "") return diffEndLine
  }
  return cursorLine
}
