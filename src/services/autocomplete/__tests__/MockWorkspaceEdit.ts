import * as vscode from "vscode"
import { mockVscode } from "./MockWorkspace.spec"

export function createMockWorkspaceEdit(): vscode.WorkspaceEdit {
	const _edits = new Map<string, vscode.TextEdit[]>()

	const createTextEdit = (range: vscode.Range, newText: string): vscode.TextEdit =>
		({ range, newText }) as vscode.TextEdit

	return {
		insert(uri: vscode.Uri, position: vscode.Position, newText: string) {
			const key = uri.toString()
			if (!_edits.has(key)) {
				_edits.set(key, [])
			}
			const range = new mockVscode.Range(position, position)
			_edits.get(key)!.push(createTextEdit(range as vscode.Range, newText))
		},

		delete(uri: vscode.Uri, range: vscode.Range) {
			const key = uri.toString()
			if (!_edits.has(key)) {
				_edits.set(key, [])
			}
			_edits.get(key)!.push(createTextEdit(range, ""))
		},

		replace(uri: vscode.Uri, range: vscode.Range, newText: string) {
			const key = uri.toString()
			if (!_edits.has(key)) {
				_edits.set(key, [])
			}
			_edits.get(key)!.push(createTextEdit(range, newText))
		},

		get(uri: vscode.Uri) {
			return _edits.get(uri.toString()) || []
		},

		entries() {
			return Array.from(_edits.entries()).map(
				([uriString, edits]) => [mockVscode.Uri.parse(uriString), edits] as [vscode.Uri, vscode.TextEdit[]],
			)
		},
	} as vscode.WorkspaceEdit
}
