import {
  CodeAction,
  CodeActionKind,
  type CodeActionContext,
  type CodeActionProvider,
  type CodeActionProviderMetadata,
  type Range,
  type Selection,
  type TextDocument,
} from "vscode"

export class KiloCodeActionProvider implements CodeActionProvider {
  static readonly metadata: CodeActionProviderMetadata = {
    providedCodeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite],
  }

  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
  ): CodeAction[] {
    if (range.isEmpty) return []

    const actions: CodeAction[] = []

    const add = new CodeAction("Add to Kilo Code", CodeActionKind.RefactorRewrite)
    add.command = { command: "kilo-code.v2.addToContext", title: "Add to Kilo Code" }
    actions.push(add)

    if (context.diagnostics.length > 0) {
      const fix = new CodeAction("Fix with Kilo Code", CodeActionKind.QuickFix)
      fix.command = { command: "kilo-code.v2.fixCode", title: "Fix with Kilo Code" }
      fix.isPreferred = true
      actions.push(fix)
      return actions
    }

    const explain = new CodeAction("Explain with Kilo Code", CodeActionKind.RefactorRewrite)
    explain.command = { command: "kilo-code.v2.explainCode", title: "Explain with Kilo Code" }
    actions.push(explain)

    const improve = new CodeAction("Improve with Kilo Code", CodeActionKind.RefactorRewrite)
    improve.command = { command: "kilo-code.v2.improveCode", title: "Improve with Kilo Code" }
    actions.push(improve)

    return actions
  }
}
