import * as vscode from "vscode"
import { promises as fs } from "fs"
import * as path from "path"

import { getReadablePath } from "../../utils/path"

type PendingFileEdit = {
	relPath: string
	readablePath: string
	absolutePath: string
	originalContent: string
	diffAnchor: vscode.Range
}

const labelDecorationType = vscode.window.createTextEditorDecorationType({
	after: {
		margin: "0 0 0 12px",
		backgroundColor: new vscode.ThemeColor("badge.background"),
		color: new vscode.ThemeColor("badge.foreground"),
		fontWeight: "500",
	},
})

const highlightDecorationType = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	backgroundColor: new vscode.ThemeColor("editor.hoverHighlightBackground"),
})

const KEEP_COMMAND = "roo.fileEdit.keep"
const UNDO_COMMAND = "roo.fileEdit.undo"
const NEXT_COMMAND = "roo.fileEdit.reviewNext"

export class FileEditReviewController implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = []
	private pendingEdits = new Map<string, PendingFileEdit>()
	private reviewQueue: string[] = []

	constructor(private cwd: string) {
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(() => this.refreshDecorations()),
			vscode.window.onDidChangeVisibleTextEditors(() => this.refreshDecorations()),
			vscode.workspace.onDidCloseTextDocument((doc) => this.handleDocumentClosed(doc)),
			vscode.commands.registerCommand(KEEP_COMMAND, (relPath?: string) => this.handleKeep(relPath)),
			vscode.commands.registerCommand(UNDO_COMMAND, (relPath?: string) => this.handleUndo(relPath)),
			vscode.commands.registerCommand(NEXT_COMMAND, () => this.handleReviewNext()),
		)
	}

	addEdit(params: { relPath: string; absolutePath: string; originalContent: string; newContent: string }) {
		const readablePath = getReadablePath(this.cwd, params.relPath)
		const diffAnchor = computeFirstDifferenceRange(params.originalContent, params.newContent)

		const pending: PendingFileEdit = {
			relPath: params.relPath,
			readablePath,
			absolutePath: params.absolutePath,
			originalContent: params.originalContent,
			diffAnchor,
		}

		this.pendingEdits.set(readablePath, pending)
		this.reviewQueue = this.reviewQueue.filter((path) => path !== readablePath)
		this.reviewQueue.push(readablePath)

		this.refreshDecorations()
	}

	async handleKeep(relPath?: string) {
		const entry = this.getEntryForPath(relPath)
		if (!entry) {
			return
		}

		this.pendingEdits.delete(entry.readablePath)
		this.reviewQueue = this.reviewQueue.filter((path) => path !== entry.readablePath)
		this.refreshDecorations()
	}

	async handleUndo(relPath?: string) {
		const entry = this.getEntryForPath(relPath)
		if (!entry) {
			return
		}

		await fs.writeFile(entry.absolutePath, entry.originalContent, "utf-8")
		await vscode.workspace.openTextDocument(entry.absolutePath).then((doc) => doc.save())

		this.pendingEdits.delete(entry.readablePath)
		this.reviewQueue = this.reviewQueue.filter((path) => path !== entry.readablePath)
		this.refreshDecorations()
	}

	async handleReviewNext() {
		const nextEntry = this.getNextEntry()
		if (!nextEntry) {
			return
		}

		const document = await vscode.workspace.openTextDocument(nextEntry.absolutePath)
		const editor = await vscode.window.showTextDocument(document, { preview: false })
		editor.revealRange(nextEntry.diffAnchor, vscode.TextEditorRevealType.InCenter)
	}

	private getEntryForPath(relPath?: string): PendingFileEdit | undefined {
		if (relPath) {
			const readablePath = getReadablePath(this.cwd, relPath)
			return this.pendingEdits.get(readablePath)
		}

		const activeEditor = vscode.window.activeTextEditor
		if (!activeEditor) {
			return undefined
		}

		const readablePath = getReadablePath(this.cwd, path.relative(this.cwd, activeEditor.document.uri.fsPath))
		return this.pendingEdits.get(readablePath)
	}

	private getNextEntry(): PendingFileEdit | undefined {
		for (const readablePath of this.reviewQueue) {
			const entry = this.pendingEdits.get(readablePath)
			if (entry) {
				return entry
			}
		}
		return undefined
	}

	private handleDocumentClosed(doc: vscode.TextDocument) {
		const readablePath = getReadablePath(this.cwd, path.relative(this.cwd, doc.uri.fsPath))
		if (this.pendingEdits.has(readablePath)) {
			this.refreshDecorations()
		}
	}

	private getOverlayMarkdown(entry?: PendingFileEdit): vscode.MarkdownString | undefined {
		if (!entry && this.pendingEdits.size === 0) {
			return undefined
		}

		const markdown = new vscode.MarkdownString(undefined, true)
		markdown.isTrusted = true

		if (entry) {
			const args = encodeURIComponent(JSON.stringify({ relPath: entry.relPath }))
			const keepLink = `[Keep](command:${KEEP_COMMAND}?${args})`
			const undoLink = `[Undo](command:${UNDO_COMMAND}?${args})`
			markdown.appendMarkdown(`${keepLink} • ${undoLink}`)
		} else {
			markdown.appendMarkdown(`[Review next file](command:${NEXT_COMMAND})`)
		}

		markdown.appendMarkdown("\n\n")
		markdown.appendMarkdown("**Pending files**\n")
		for (const filePath of this.reviewQueue) {
			if (this.pendingEdits.has(filePath)) {
				markdown.appendMarkdown(`- ${filePath}\n`)
			}
		}

		return markdown
	}

	private refreshDecorations() {
		const hasPending = this.pendingEdits.size > 0
		for (const editor of vscode.window.visibleTextEditors) {
			const readableEditorPath = getReadablePath(this.cwd, path.relative(this.cwd, editor.document.uri.fsPath))
			const entry = this.pendingEdits.get(readableEditorPath)

			const labelDecorations: vscode.DecorationOptions[] = []
			const highlightDecorations: vscode.DecorationOptions[] = []

			if (entry) {
				const labelRange = new vscode.Range(editor.document.lineCount - 1, 0, editor.document.lineCount - 1, 0)
				labelDecorations.push({
					range: labelRange,
					hoverMessage: this.getOverlayMarkdown(entry),
					renderOptions: {
						after: {
							contentText: ` $(tools) Review changes`,
						},
					},
				})

				highlightDecorations.push({
					range: entry.diffAnchor,
					hoverMessage: this.getOverlayMarkdown(entry),
				})
			} else if (hasPending) {
				const labelRange = new vscode.Range(editor.document.lineCount - 1, 0, editor.document.lineCount - 1, 0)
				labelDecorations.push({
					range: labelRange,
					hoverMessage: this.getOverlayMarkdown(),
					renderOptions: {
						after: {
							contentText: ` $(arrow-right) Review next file`,
						},
					},
				})
			}

			editor.setDecorations(labelDecorationType, labelDecorations)
			editor.setDecorations(highlightDecorationType, highlightDecorations)
		}
	}

	dispose() {
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.pendingEdits.clear()
		this.reviewQueue = []
		vscode.window.visibleTextEditors.forEach((editor) => {
			editor.setDecorations(labelDecorationType, [])
			editor.setDecorations(highlightDecorationType, [])
		})
	}
}

function computeFirstDifferenceRange(originalContent: string, newContent: string): vscode.Range {
	const originalLines = originalContent.split("\n")
	const newLines = newContent.split("\n")

	let line = 0
	while (line < originalLines.length && line < newLines.length && originalLines[line] === newLines[line]) {
		line++
	}

	const originalLine = originalLines[line] ?? ""
	const newLine = newLines[line] ?? ""

	let character = 0
	while (
		character < originalLine.length &&
		character < newLine.length &&
		originalLine[character] === newLine[character]
	) {
		character++
	}

	return new vscode.Range(line, character, line, character)
}
