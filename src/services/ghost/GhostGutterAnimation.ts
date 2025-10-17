import * as vscode from "vscode"
import type { GhostServiceSettings } from "@roo-code/types"

export class GhostGutterAnimation {
	private state: "hide" | "active" = "hide"
	private decorationActive: vscode.TextEditorDecorationType
	private isEnabled: boolean = true

	public constructor(context: vscode.ExtensionContext) {
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
		}
	}

	private getPosition(editor: vscode.TextEditor): vscode.Range {
		const position = editor.selection.active
		const document = editor.document
		const lineEndPosition = new vscode.Position(position.line, document.lineAt(position.line).text.length)
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
		editor.setDecorations(this.decorationActive, [position])
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
		this.decorationActive.dispose()
	}
}
