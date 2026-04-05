/**
 * VisibleCodeTracker - Captures the actual visible code in VS Code editors
 *
 * This service captures what code is currently visible on the user's screen,
 * not just what files are open. It uses the VS Code API to get:
 * - All visible text editors (not just tabs)
 * - The actual visible line ranges in each editor's viewport
 * - Cursor positions and selections
 */

import * as vscode from "vscode"

import { isSecurityConcern } from "../continuedev/core/indexing/ignore"
import type { FileIgnoreController } from "../shims/FileIgnoreController"

function toRelativePath(absolutePath: string, workspacePath: string): string {
  return vscode.workspace.asRelativePath(absolutePath, false) || absolutePath.replace(workspacePath + "/", "")
}

import { VisibleCodeContext, VisibleEditorInfo, VisibleRange, DiffInfo } from "../types"
import { extractDiffInfo as _extractDiffInfo } from "./visible-code-utils"

// Git-related URI schemes that should be captured for diff support
const GIT_SCHEMES = ["git", "gitfs", "file", "vscode-remote"]

export class VisibleCodeTracker {
  private lastContext: VisibleCodeContext | null = null

  constructor(
    private workspacePath: string,
    private ignoreController: FileIgnoreController | null = null,
  ) {}

  /**
   * Captures the currently visible code across all visible editors.
   * Excludes files matching security patterns or .kilocodeignore rules.
   *
   * @returns VisibleCodeContext containing information about all visible editors
   * and their visible code ranges
   */
  public async captureVisibleCode(): Promise<VisibleCodeContext> {
    const editors = vscode.window.visibleTextEditors
    const activeUri = vscode.window.activeTextEditor?.document.uri.toString()

    const editorInfos: VisibleEditorInfo[] = []

    for (const editor of editors) {
      const document = editor.document
      const scheme = document.uri.scheme

      // Skip non-code documents (output panels, extension host output, etc.)
      if (!GIT_SCHEMES.includes(scheme)) {
        continue
      }

      const filePath = document.uri.fsPath
      const relativePath = toRelativePath(filePath, this.workspacePath)

      if (isSecurityConcern(filePath)) {
        console.log(`[VisibleCodeTracker] Filtered (security): ${relativePath}`)
        continue
      }
      if (this.ignoreController && !this.ignoreController.validateAccess(relativePath)) {
        console.log(`[VisibleCodeTracker] Filtered (.kilocodeignore): ${relativePath}`)
        continue
      }

      const visibleRanges: VisibleRange[] = []

      for (const range of editor.visibleRanges) {
        const content = document.getText(range)
        visibleRanges.push({
          startLine: range.start.line,
          endLine: range.end.line,
          content,
        })
      }

      const isActive = document.uri.toString() === activeUri

      // Extract diff information for git-backed documents
      const diffInfo = this.extractDiffInfo(document.uri)

      editorInfos.push({
        filePath,
        relativePath,
        languageId: document.languageId,
        isActive,
        visibleRanges,
        cursorPosition: editor.selection
          ? {
              line: editor.selection.active.line,
              character: editor.selection.active.character,
            }
          : null,
        selections: editor.selections.map((sel) => ({
          start: { line: sel.start.line, character: sel.start.character },
          end: { line: sel.end.line, character: sel.end.character },
        })),
        diffInfo,
      })
    }

    this.lastContext = {
      timestamp: Date.now(),
      editors: editorInfos,
    }

    return this.lastContext
  }

  /**
   * Returns the last captured context, or null if never captured.
   */
  public getLastContext(): VisibleCodeContext | null {
    return this.lastContext
  }

  /**
   * Extract diff information from a URI.
   * Git URIs typically look like: git:/path/to/file.ts?ref=HEAD~1
   */
  private extractDiffInfo(uri: vscode.Uri): DiffInfo | undefined {
    return _extractDiffInfo(uri.scheme, uri.query, uri.fsPath)
  }
}
