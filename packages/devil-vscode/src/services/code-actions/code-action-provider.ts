import * as vscode from "vscode"

export class KiloCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (range.isEmpty) return []

    const actions: vscode.CodeAction[] = []

    const add = new vscode.CodeAction("Add to Kilo Code", vscode.CodeActionKind.RefactorRewrite)
    add.command = { command: "kilo-code.new.addToContext", title: "Add to Kilo Code" }
    actions.push(add)

    const hasDiagnostics = context.diagnostics.length > 0

    if (hasDiagnostics) {
      const fix = new vscode.CodeAction("Fix with Kilo Code", vscode.CodeActionKind.QuickFix)
      fix.command = { command: "kilo-code.new.fixCode", title: "Fix with Kilo Code" }
      fix.isPreferred = true
      actions.push(fix)
    }

    if (!hasDiagnostics) {
      const explain = new vscode.CodeAction("Explain with Kilo Code", vscode.CodeActionKind.RefactorRewrite)
      explain.command = { command: "kilo-code.new.explainCode", title: "Explain with Kilo Code" }
      actions.push(explain)

      const improve = new vscode.CodeAction("Improve with Kilo Code", vscode.CodeActionKind.RefactorRewrite)
      improve.command = { command: "kilo-code.new.improveCode", title: "Improve with Kilo Code" }
      actions.push(improve)
    }

    return actions
  }
}
