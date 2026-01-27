import * as vscode from "vscode"
import { SidebarProvider } from "./sidebar"

export function activate(context: vscode.ExtensionContext) {
  const sidebar = new SidebarProvider(context)

  context.subscriptions.push(vscode.window.registerWebviewViewProvider("kilo-sidebar", sidebar))
}

export function deactivate() {}
