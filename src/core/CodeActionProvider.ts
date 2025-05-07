import * as vscode from "vscode"

import { EditorUtils } from "./EditorUtils"

export type CodeActionName = "EXPLAIN" | "FIX" | "IMPROVE" | "ADD_TO_CONTEXT" | "NEW_TASK"

export type CodeActionId =
	| "kilo-code.explainCode"
	| "kilo-code.fixCode"
	| "kilo-code.improveCode"
	| "kilo-code.addToContext"
	| "kilo-code.newTask"

export const ACTION_TITLES: Record<CodeActionName, string> = {
	EXPLAIN: "Explain with Kilo Code",
	FIX: "Fix with Kilo Code",
	IMPROVE: "Improve with Kilo Code",
	ADD_TO_CONTEXT: "Add to Kilo Code",
	NEW_TASK: "New Kilo Code Task",
} as const

export const COMMAND_IDS: Record<CodeActionName, CodeActionId> = {
	EXPLAIN: "kilo-code.explainCode",
	FIX: "kilo-code.fixCode",
	IMPROVE: "kilo-code.improveCode",
	ADD_TO_CONTEXT: "kilo-code.addToContext",
	NEW_TASK: "kilo-code.newTask",
} as const

export class CodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix,
		vscode.CodeActionKind.RefactorRewrite,
	]

	private createAction(
		title: string,
		kind: vscode.CodeActionKind,
		command: CodeActionId,
		args: any[],
	): vscode.CodeAction {
		const action = new vscode.CodeAction(title, kind)
		action.command = { command, title, arguments: args }
		return action
	}

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
	): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
		try {
			const effectiveRange = EditorUtils.getEffectiveRange(document, range)

			if (!effectiveRange) {
				return []
			}

			const filePath = EditorUtils.getFilePath(document)
			const actions: vscode.CodeAction[] = []

			actions.push(
				this.createAction(
					ACTION_TITLES.ADD_TO_CONTEXT,
					vscode.CodeActionKind.QuickFix,
					COMMAND_IDS.ADD_TO_CONTEXT,
					[
						filePath,
						effectiveRange.text,
						effectiveRange.range.start.line + 1,
						effectiveRange.range.end.line + 1,
					],
				),
			)

			if (context.diagnostics.length > 0) {
				const relevantDiagnostics = context.diagnostics.filter((d) =>
					EditorUtils.hasIntersectingRange(effectiveRange.range, d.range),
				)

				if (relevantDiagnostics.length > 0) {
					actions.push(
						this.createAction(ACTION_TITLES.FIX, vscode.CodeActionKind.QuickFix, COMMAND_IDS.FIX, [
							filePath,
							effectiveRange.text,
							effectiveRange.range.start.line + 1,
							effectiveRange.range.end.line + 1,
							relevantDiagnostics.map(EditorUtils.createDiagnosticData),
						]),
					)
				}
			} else {
				actions.push(
					this.createAction(ACTION_TITLES.EXPLAIN, vscode.CodeActionKind.QuickFix, COMMAND_IDS.EXPLAIN, [
						filePath,
						effectiveRange.text,
						effectiveRange.range.start.line + 1,
						effectiveRange.range.end.line + 1,
					]),
				)

				actions.push(
					this.createAction(ACTION_TITLES.IMPROVE, vscode.CodeActionKind.QuickFix, COMMAND_IDS.IMPROVE, [
						filePath,
						effectiveRange.text,
						effectiveRange.range.start.line + 1,
						effectiveRange.range.end.line + 1,
					]),
				)
			}

			return actions
		} catch (error) {
			console.error("Error providing code actions:", error)
			return []
		}
	}
}
