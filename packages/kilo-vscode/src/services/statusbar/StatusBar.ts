import * as vscode from "vscode"

export class StatusBar {
  private readonly item: vscode.StatusBarItem

  constructor(alignment: vscode.StatusBarAlignment = vscode.StatusBarAlignment.Right, priority = 100) {
    this.item = vscode.window.createStatusBarItem(alignment, priority)
  }

  update(text: string, tooltip: string | vscode.MarkdownString, visible: boolean): void {
    this.item.text = text
    this.item.tooltip = tooltip
    if (visible) {
      this.item.show()
    } else {
      this.item.hide()
    }
  }

  dispose(): void {
    this.item.dispose()
  }
}
