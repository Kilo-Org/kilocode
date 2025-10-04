import * as vscode from "vscode"
import type { GhostServiceSettings } from "@roo-code/types"

export class GhostGutterAnimation {
	private state: "hide" | "wait" | "active" = "hide"
	private decorationWait: vscode.TextEditorDecorationType
	private decorationActive: vscode.TextEditorDecorationType
	private isEnabled: boolean = true

	public constructor(context: vscode.ExtensionContext) {
		this.decorationWait = vscode.window.createTextEditorDecorationType({
			gutterIconPath: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "logo-outline-black.gif"),
			gutterIconSize: "30px",
			isWholeLine: false,
		})
		this.decorationActive = vscode.window.createTextEditorDecorationType({
			gutterIconPath: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "logo-outline-yellow.gif"),
			gutterIconSize: "30px",
			isWholeLine: false,
		})
	}

	public updateSettings(settings: GhostServiceSettings | undefined) {
		this.isEnabled = settings?.showGutterAnimation !== false
		if (!this.isEnabled) {
			this.clearDecorations()
		}
	}

	private clearDecorations() {
		const editor = vscode.window.activeTextEditor
		if (editor) {
			editor.setDecorations(this.decorationActive, [])
			editor.setDecorations(this.decorationWait, [])
		}
	}

	private getPosition(editor: vscode.TextEditor): vscode.Range {
		const position = editor.selection.active
		const document = editor.document

		// Ensure the line number is valid to prevent "Illegal value for `line`" error
		const validLine = Math.max(0, Math.min(position.line, document.lineCount - 1))
		const lineEndPosition = new vscode.Position(validLine, document.lineAt(validLine).text.length)
		return new vscode.Range(lineEndPosition, lineEndPosition)
	}

	public update() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		if (!this.isEnabled || this.state == "hide") {
			this.clearDecorations()
			return
		}

		const position = this.getPosition(editor)
		if (this.state == "wait") {
			editor.setDecorations(this.decorationActive, [])
			editor.setDecorations(this.decorationWait, [position])
			return
		}
		editor.setDecorations(this.decorationWait, [])
		editor.setDecorations(this.decorationActive, [position])
	}

	public wait() {
		this.state = "wait"
		this.update()
	}

	public active() {
		this.state = "active"
		this.update()
	}

	public hide() {
		this.state = "hide"
		this.update()
	}

	public dispose() {
		const editor = vscode.window.activeTextEditor
		editor?.setDecorations(this.decorationActive, [])
		editor?.setDecorations(this.decorationWait, [])
		this.decorationWait.dispose()
		this.decorationActive.dispose()
	}
}
