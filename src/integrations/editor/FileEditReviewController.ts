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

const highlightDecorationType = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	backgroundColor: new vscode.ThemeColor("editor.hoverHighlightBackground"),
})

const ACCEPT_COMMAND = "axon-code.fileEdit.accept"
const ACCEPT_ALL_COMMAND = "axon-code.fileEdit.acceptAll"
const REJECT_COMMAND = "axon-code.fileEdit.reject"
const NEXT_COMMAND = "axon-code.fileEdit.reviewNext"

export class FileEditReviewController implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = []
	private pendingEdits = new Map<string, PendingFileEdit>()
	private reviewQueue: string[] = []
	private readonly codeLensEmitter = new vscode.EventEmitter<void>()
	private readonly codeLensProvider: FileEditReviewCodeLensProvider

	constructor(private cwd: string) {
		// Old UI (comment thread actions) — kept for reference.
		//
		// this.commentController = vscode.comments.createCommentController("axon-code.review", "Axon Code Review")
		// this.commentController.commentingRangeProvider = {
		// 	provideCommentingRanges: () => [], // Disable manual commenting
		// }

		this.codeLensProvider = new FileEditReviewCodeLensProvider(
			this.cwd,
			() => this.pendingEdits,
			this.codeLensEmitter.event,
		)

		this.disposables.push(
			this.codeLensEmitter,
			vscode.languages.registerCodeLensProvider({ scheme: "file" }, this.codeLensProvider),
			vscode.window.onDidChangeActiveTextEditor(() => this.refreshDecorations()),
			vscode.window.onDidChangeVisibleTextEditors(() => this.refreshDecorations()),
			vscode.workspace.onDidCloseTextDocument((doc) => this.handleDocumentClosed(doc)),
			vscode.commands.registerCommand(ACCEPT_COMMAND, (arg?: any) => this.handleAccept(arg)),
			vscode.commands.registerCommand(ACCEPT_ALL_COMMAND, () => this.handleAcceptAll()),
			vscode.commands.registerCommand(REJECT_COMMAND, (arg?: any) => this.handleReject(arg)),
			vscode.commands.registerCommand(NEXT_COMMAND, () => this.handleReviewNext()),
		)
	}

	addEdit(params: { relPath: string; absolutePath: string; originalContent: string; newContent: string }) {
		const readablePath = getReadablePath(this.cwd, params.relPath)
		const diffAnchor = computeFirstDifferenceRange(params.originalContent, params.newContent)

		// Old UI (comment thread actions) — kept for reference.
		//
		// let entry = this.pendingEdits.get(readablePath)
		// if (entry && entry.thread) {
		// 	entry.thread.dispose()
		// }
		//
		// const uri = vscode.Uri.file(params.absolutePath)
		// const thread = this.commentController.createCommentThread(uri, diffAnchor, [])
		// thread.canReply = false
		// thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded
		// thread.label = "Axon Code"
		//
		// // We don't necessarily need a comment body if the title actions are enough,
		// // but a body explains what's happening.
		// thread.comments = [
		// 	{
		// 		author: { name: "Review Changes" },
		// 		body: "",
		// 		mode: vscode.CommentMode.Preview,
		// 	},
		// ]

		const pending: PendingFileEdit = {
			relPath: params.relPath,
			readablePath,
			absolutePath: params.absolutePath,
			originalContent: params.originalContent,
			diffAnchor,
		}

		this.pendingEdits.set(readablePath, pending)
		// Ensure unique queue items
		this.reviewQueue = this.reviewQueue.filter((path) => path !== readablePath)
		this.reviewQueue.push(readablePath)

		this.refreshDecorations()
		this.codeLensEmitter.fire()
	}

	async handleAccept(arg?: any) {
		// Arg can be a CommentThread if triggered from menu, or relPath if triggered programmatically
		let entry: PendingFileEdit | undefined

		if (arg && (arg as vscode.CommentThread).uri) {
			const thread = arg as vscode.CommentThread
			const readablePath = getReadablePath(this.cwd, path.relative(this.cwd, thread.uri.fsPath))
			entry = this.pendingEdits.get(readablePath)
		} else if (typeof arg === "string") {
			const readablePath = getReadablePath(this.cwd, arg)
			entry = this.pendingEdits.get(readablePath)
		} else {
			// Fallback: active editor
			const activeEditor = vscode.window.activeTextEditor
			if (activeEditor) {
				const readablePath = getReadablePath(
					this.cwd,
					path.relative(this.cwd, activeEditor.document.uri.fsPath),
				)
				entry = this.pendingEdits.get(readablePath)
			}
		}

		if (!entry) {
			return
		}

		// Accept means we keep the changes. Just clean up.
		this.clearEntry(entry)
		this.refreshDecorations()

		// If we just accepted the current file, try to go to the next one
		if (this.reviewQueue.length > 0) {
			// Optional: auto-advance behavior?
			// this.handleReviewNext()
		}
	}

	async handleReject(arg?: any) {
		let entry: PendingFileEdit | undefined

		if (arg && (arg as vscode.CommentThread).uri) {
			const thread = arg as vscode.CommentThread
			const readablePath = getReadablePath(this.cwd, path.relative(this.cwd, thread.uri.fsPath))
			entry = this.pendingEdits.get(readablePath)
		} else if (typeof arg === "string") {
			const readablePath = getReadablePath(this.cwd, arg)
			entry = this.pendingEdits.get(readablePath)
		} else {
			// Fallback: active editor
			const activeEditor = vscode.window.activeTextEditor
			if (activeEditor) {
				const readablePath = getReadablePath(
					this.cwd,
					path.relative(this.cwd, activeEditor.document.uri.fsPath),
				)
				entry = this.pendingEdits.get(readablePath)
			}
		}

		if (!entry) {
			return
		}

		await fs.writeFile(entry.absolutePath, entry.originalContent, "utf-8")
		// Force reload/save not strictly needed as file watcher handles it,
		// but ensures editor updates

		this.clearEntry(entry)
		this.refreshDecorations()

		if (this.reviewQueue.length > 0) {
			// Optional: auto-advance
		}
	}

	async handleAcceptAll() {
		if (this.pendingEdits.size === 0) return

		this.pendingEdits.clear()
		this.reviewQueue = []
		this.refreshDecorations()
		this.codeLensEmitter.fire()
	}

	async handleReviewNext() {
		const nextEntry = this.getNextEntry()
		if (!nextEntry) {
			vscode.window.showInformationMessage("No more pending file reviews.")
			return
		}

		const document = await vscode.workspace.openTextDocument(nextEntry.absolutePath)
		const editor = await vscode.window.showTextDocument(document, { preview: false })
		editor.revealRange(nextEntry.diffAnchor, vscode.TextEditorRevealType.InCenter)
	}

	private clearEntry(entry: PendingFileEdit) {
		// Old UI (comment thread actions) — kept for reference.
		// if (entry.thread) {
		// 	entry.thread.dispose()
		// }
		this.pendingEdits.delete(entry.readablePath)
		this.reviewQueue = this.reviewQueue.filter((path) => path !== entry.readablePath)
		this.codeLensEmitter.fire()
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
			// Keep decorations + codelens in sync when files close/reopen.
			this.refreshDecorations()
			this.codeLensEmitter.fire()
		}
	}

	private refreshDecorations() {
		// We still use highlight decorations; accept/reject is provided via CodeLens.
		for (const editor of vscode.window.visibleTextEditors) {
			const readableEditorPath = getReadablePath(this.cwd, path.relative(this.cwd, editor.document.uri.fsPath))
			const entry = this.pendingEdits.get(readableEditorPath)

			const highlightDecorations: vscode.DecorationOptions[] = []

			if (entry) {
				highlightDecorations.push({
					range: entry.diffAnchor,
				})
			}

			editor.setDecorations(highlightDecorationType, highlightDecorations)
		}
	}

	dispose() {
		for (const disposable of this.disposables) {
			disposable.dispose()
		}

		// Old UI (comment thread actions) — kept for reference.
		// for (const entry of this.pendingEdits.values()) {
		// 	entry.thread?.dispose()
		// }

		this.pendingEdits.clear()
		this.reviewQueue = []
		vscode.window.visibleTextEditors.forEach((editor) => {
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

	// Just return the line for simplicity in this visual anchor
	return new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER)
}

class FileEditReviewCodeLensProvider implements vscode.CodeLensProvider {
	public readonly onDidChangeCodeLenses?: vscode.Event<void>

	constructor(
		private readonly cwd: string,
		private readonly getPendingEdits: () => Map<string, PendingFileEdit>,
		onDidChangeCodeLenses: vscode.Event<void>,
	) {
		this.onDidChangeCodeLenses = onDidChangeCodeLenses
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const readablePath = getReadablePath(this.cwd, path.relative(this.cwd, document.uri.fsPath))
		const entry = this.getPendingEdits().get(readablePath)
		if (!entry) return []

		const line = Math.max(0, entry.diffAnchor.start.line)
		const anchor = new vscode.Range(line, 0, line, 0)

		return [
			new vscode.CodeLens(anchor, {
				title: "Accept",
				command: ACCEPT_COMMAND,
				arguments: [entry.relPath],
			}),
			new vscode.CodeLens(anchor, {
				title: "Reject",
				command: REJECT_COMMAND,
				arguments: [entry.relPath],
			}),
			new vscode.CodeLens(anchor, {
				title: "Next",
				command: NEXT_COMMAND,
				arguments: [],
			}),
			new vscode.CodeLens(anchor, {
				title: "Accept all",
				command: ACCEPT_ALL_COMMAND,
				arguments: [],
			}),
		]
	}
}
