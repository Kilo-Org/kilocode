import * as vscode from "vscode"
import { nesLog } from "./log"
import { planInsertion, planReplacement } from "./pendingEdit"

const PENDING_CONTEXT_KEY = "kilo-code.nextEdit.hasPendingSuggestion"
const CHAIN_DELAY_MS = 60

export type PendingNextEdit =
  | {
      kind: "replace"
      document: vscode.TextDocument
      /** Inclusive start line of the lines being replaced. */
      diffStartLine: number
      /** Inclusive end line of the lines being replaced. */
      diffEndLine: number
      /** New text to substitute for [diffStartLine, diffEndLine]. */
      replacement: string
      /** Whether the suggestion omits complete lines rather than rewriting one as blank. */
      removesLines: boolean
      /** Snapshot of the original text — used to detect drift. */
      originalText: string
    }
  | {
      kind: "insert"
      document: vscode.TextDocument
      /** Existing line before insertion, or `lineCount` when appending at EOF. */
      diffStartLine: number
      /** Same as diffStartLine for hint/jump-target purposes. */
      diffEndLine: number
      /** Lines to insert. Must end with a newline so existing content gets pushed down. */
      replacement: string
      /** Snapshot of the surrounding (single) line — used as a soft drift guard. */
      originalText: string
    }

/**
 * Holds the currently-pending out-of-cursor NES suggestion and renders a
 * jump-to-next-edit affordance via editor decorations. Same-line diffs are
 * still handled by `InlineCompletionItem` (faster, native ghost text) — this
 * manager is for everything else.
 *
 * Lifecycle: at most one pending suggestion at a time. A pending suggestion
 * is cleared when the user accepts, dismisses, edits inside the diff range,
 * or moves to a different document.
 */
export class NextEditSuggestionManager implements vscode.Disposable {
  private pending: PendingNextEdit | null = null
  private readonly subscriptions: vscode.Disposable[] = []

  private readonly removedLineDecoration: vscode.TextEditorDecorationType
  private readonly proposedLineDecoration: vscode.TextEditorDecorationType
  private readonly hintDecoration: vscode.TextEditorDecorationType

  constructor() {
    // Tints + strikethrough on the lines that will be replaced or removed.
    this.removedLineDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"),
      overviewRulerColor: new vscode.ThemeColor("editorInfo.foreground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      textDecoration: "line-through; opacity: 0.65;",
    })
    // Inline `after` text showing the proposed replacement line.
    this.proposedLineDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 2em",
        color: new vscode.ThemeColor("editorInfo.foreground"),
        fontStyle: "italic",
      },
    })
    // The one-line user-facing hint.
    this.hintDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 2em",
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
      },
    })

    // Dismiss when the document or selection moves in ways that invalidate
    // the prediction.
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        const p = this.pending
        if (!p) return
        if (e.document !== p.document) return
        // For "insert" we just confirm the anchor line is still there with its
        // original content; for "replace" we re-check the full range.
        let stillValid = true
        try {
          if (p.kind === "replace") {
            const text = e.document.getText(
              new vscode.Range(
                new vscode.Position(p.diffStartLine, 0),
                new vscode.Position(p.diffEndLine, e.document.lineAt(p.diffEndLine).range.end.character),
              ),
            )
            stillValid = text === p.originalText
          } else {
            // Insert mode: only invalidate if the anchor line shifted.
            const anchorLine = Math.min(p.diffStartLine, e.document.lineCount - 1)
            const anchorText = e.document.lineAt(anchorLine).text
            stillValid = anchorText === p.originalText
          }
        } catch {
          stillValid = false
        }
        if (!stillValid) this.clear()
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.clear()),
      // When the cursor moves (e.g., post-jump), refresh the hint so it
      // flips between "Tab to jump" and "Tab to apply".
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (!this.pending) return
        if (e.textEditor.document !== this.pending.document) return
        this.renderDecorations(this.pending)
      }),
    )
  }

  public isPending(): boolean {
    return this.pending !== null
  }

  public setPending(p: PendingNextEdit): void {
    this.clearDecorations()
    this.pending = p
    void vscode.commands.executeCommand("setContext", PENDING_CONTEXT_KEY, true)
    // Hide any in-flight inline suggestion so it can't compete with our Tab handler.
    void vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
    this.renderDecorations(p)
  }

  public clear(): void {
    if (!this.pending) return
    this.pending = null
    this.clearDecorations()
    void vscode.commands.executeCommand("setContext", PENDING_CONTEXT_KEY, false)
  }

  /** Tab handler — accept if cursor near the diff, else jump. */
  public async acceptOrJump(): Promise<void> {
    const p = this.pending
    if (!p) return
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document !== p.document) {
      this.clear()
      return
    }
    const cursor = editor.selection.active
    const inside =
      p.kind === "replace"
        ? cursor.line >= p.diffStartLine && cursor.line <= p.diffEndLine
        : cursor.line === p.diffStartLine || cursor.line === p.diffStartLine - 1
    if (inside) {
      await this.applyPending()
    } else {
      const targetLine = Math.min(p.diffStartLine, Math.max(0, p.document.lineCount - 1))
      const targetChar = p.document.lineAt(targetLine).firstNonWhitespaceCharacterIndex
      const target = new vscode.Position(targetLine, targetChar)
      editor.selection = new vscode.Selection(target, target)
      editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
      nesLog(`jumped cursor ${cursor.line} -> ${target.line} (pending diff at [${p.diffStartLine}..${p.diffEndLine}])`)
      // Refresh hint immediately so "Tab to apply" is shown.
      this.renderDecorations(p)
    }
  }

  private async applyPending(): Promise<void> {
    const p = this.pending
    if (!p) return
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document !== p.document) {
      this.clear()
      return
    }
    // Snapshot what we're about to do, then nuke pending state so the upcoming
    // document change doesn't re-enter via the invalidation listener.
    this.clearDecorations()
    this.pending = null
    void vscode.commands.executeCommand("setContext", PENDING_CONTEXT_KEY, false)

    let ok = false
    if (p.kind === "insert") {
      // Re-validate before applying: the anchor line must still hold its
      // original text. Without this, edits between the anchor and the insertion
      // point can shift line numbers and land the insert in the wrong place.
      const anchorLine = Math.min(p.diffStartLine, editor.document.lineCount - 1)
      const anchorText = anchorLine >= 0 ? editor.document.lineAt(anchorLine).text : undefined
      if (anchorText !== p.originalText) {
        nesLog(`document drifted since suggestion was made — dropping insert at line ${p.diffStartLine}`)
        return
      }
      const edit = planInsertion(p, {
        lineCount: editor.document.lineCount,
        end: (line) => editor.document.lineAt(line).range.end.character,
      })
      const pos = new vscode.Position(edit.line, edit.character)
      ok = await editor.edit((b) => b.insert(pos, edit.text))
      nesLog(`applied insert at line ${pos.line} (${edit.text.length} chars, ok=${ok})`)
    } else {
      const range = new vscode.Range(
        new vscode.Position(p.diffStartLine, 0),
        new vscode.Position(p.diffEndLine, p.document.lineAt(p.diffEndLine).range.end.character),
      )
      const currentInDoc = editor.document.getText(range)
      if (currentInDoc !== p.originalText) {
        nesLog(`document drifted since suggestion was made — dropping range [${p.diffStartLine}..${p.diffEndLine}]`)
        return
      }
      const edit = planReplacement(p, {
        lineCount: editor.document.lineCount,
        end: (line) => editor.document.lineAt(line).range.end.character,
      })
      const target = new vscode.Range(
        new vscode.Position(edit.start.line, edit.start.character),
        new vscode.Position(edit.end.line, edit.end.character),
      )
      ok = await editor.edit((b) => b.replace(target, edit.text))
      nesLog(`applied replace at lines [${p.diffStartLine}..${p.diffEndLine}] (ok=${ok})`)
    }
    if (ok) chainNextPrediction()
  }

  private renderDecorations(p: PendingNextEdit): void {
    // Same document can be open in multiple splits — paint all of them so the
    // user sees the decoration regardless of which split has focus.
    const editors = vscode.window.visibleTextEditors.filter((e) => e.document === p.document)
    if (editors.length === 0) return

    const removedRanges: vscode.Range[] = []
    const proposedAnnotations: vscode.DecorationOptions[] = []

    if (p.kind === "replace") {
      const originalLines = p.originalText.split("\n")
      const proposedLines = p.replacement.split("\n")
      const minLen = Math.min(originalLines.length, proposedLines.length)
      for (let i = 0; i < minLen; i++) {
        if (originalLines[i] === proposedLines[i]) continue
        const lineNo = p.diffStartLine + i
        const lineRange = p.document.lineAt(lineNo).range
        removedRanges.push(lineRange)
        proposedAnnotations.push({
          range: new vscode.Range(lineRange.end, lineRange.end),
          renderOptions: { after: { contentText: `→ ${visualize(proposedLines[i])}` } },
        })
      }
      // Pure deletions inside a replace
      for (let i = minLen; i < originalLines.length; i++) {
        const lineNo = p.diffStartLine + i
        const lineRange = p.document.lineAt(lineNo).range
        removedRanges.push(lineRange)
        proposedAnnotations.push({
          range: new vscode.Range(lineRange.end, lineRange.end),
          renderOptions: { after: { contentText: `→ (removed)` } },
        })
      }
      // Additions inside a replace — anchor on last shared line
      if (proposedLines.length > originalLines.length) {
        const tailLineNo = p.diffStartLine + originalLines.length - 1
        const safeLine = Math.max(p.diffStartLine, Math.min(tailLineNo, p.diffEndLine))
        const tailRange = p.document.lineAt(safeLine).range
        const added = proposedLines.slice(originalLines.length).map(visualize).join(" ⏎ ")
        proposedAnnotations.push({
          range: new vscode.Range(tailRange.end, tailRange.end),
          renderOptions: { after: { contentText: `+ ${added}` } },
        })
      }
    } else {
      // Pure insertion: anchor the ghost text on the existing line, no strikethrough.
      const anchorLine = Math.min(p.diffStartLine, p.document.lineCount - 1)
      const safeAnchor = Math.max(0, anchorLine)
      const anchorRange = p.document.lineAt(safeAnchor).range
      // Strip the trailing \n we appended for insertion semantics, then show each
      // inserted line collapsed with a small separator.
      const lines = p.replacement.replace(/\n$/, "").split("\n").map(visualize)
      const inserted = lines.join(" ⏎ ")
      proposedAnnotations.push({
        range: new vscode.Range(anchorRange.end, anchorRange.end),
        renderOptions: { after: { contentText: `+ ${inserted}` } },
      })
    }

    // Hint anchor + cursor check use the active editor if it's one of ours,
    // else fall back to the first visible editor for this document.
    const active = vscode.window.activeTextEditor
    const referenceEditor = active && editors.includes(active) ? active : editors[0]
    const hintAnchor = Math.min(p.diffStartLine, p.document.lineCount - 1)
    const hintLineEnd = p.document.lineAt(Math.max(0, hintAnchor)).range.end
    const cursor = referenceEditor.selection.active
    const cursorAtDiff =
      p.kind === "replace"
        ? cursor.line >= p.diffStartLine && cursor.line <= p.diffEndLine
        : cursor.line === p.diffStartLine || cursor.line === p.diffStartLine - 1
    const hintText = cursorAtDiff ? "  ↳ Tab to apply · Esc to dismiss" : "  ↳ Tab to jump here · Esc to dismiss"
    const hintOptions: vscode.DecorationOptions[] = [
      {
        range: new vscode.Range(hintLineEnd, hintLineEnd),
        renderOptions: { after: { contentText: hintText } },
      },
    ]

    for (const editor of editors) {
      editor.setDecorations(this.removedLineDecoration, removedRanges)
      editor.setDecorations(this.proposedLineDecoration, proposedAnnotations)
      editor.setDecorations(this.hintDecoration, hintOptions)
    }
  }

  private clearDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.removedLineDecoration, [])
      editor.setDecorations(this.proposedLineDecoration, [])
      editor.setDecorations(this.hintDecoration, [])
    }
  }

  public dispose(): void {
    this.clear()
    for (const s of this.subscriptions) s.dispose()
    this.subscriptions.length = 0
    this.removedLineDecoration.dispose()
    this.proposedLineDecoration.dispose()
    this.hintDecoration.dispose()
  }
}

/**
 * Re-invoke VSCode's inline-suggest UI after an accept so the provider fires
 * again and surfaces the next prediction without the user having to type.
 * This is the "Tab-Tab-Tab" walk-through-a-refactor UX from Cursor.
 *
 * A short delay lets the document change settle before we re-enter
 * `provideInlineCompletionItems`, and gives the user a moment to abandon the
 * chain by typing or moving the cursor.
 */
export function chainNextPrediction(delayMs = CHAIN_DELAY_MS): void {
  setTimeout(() => {
    void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
  }, delayMs)
}

function visualize(line: string): string {
  // VSCode after-text decorations don't support newlines — collapse just in case.
  // Also surface leading whitespace explicitly so it isn't visually swallowed.
  const collapsed = line.replace(/\s+$/g, "").replace(/^\t+/, (t) => "  ".repeat(t.length))
  return collapsed.length > 120 ? collapsed.slice(0, 117) + "…" : collapsed
}
