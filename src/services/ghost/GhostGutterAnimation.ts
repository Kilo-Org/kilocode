import * as vscode from "vscode"

export class GhostGutterAnimation {
	private state: "hide" | "wait" | "active" = "hide"
	private decorationWait: vscode.TextEditorDecorationType
	private decorationActive: vscode.TextEditorDecorationType

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
		if (this.state == "hide") {
			editor.setDecorations(this.decorationActive, [])
			editor.setDecorations(this.decorationWait, [])
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
