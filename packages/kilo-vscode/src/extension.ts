import * as vscode from "vscode"
import { KiloProvider } from "./KiloProvider"
import { AgentManagerProvider } from "./AgentManagerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { KiloConnectionService } from "./services/cli-backend"

export function activate(context: vscode.ExtensionContext) {
  console.log("Kilo Code extension is now active")

  // Create shared connection service (one server for all webviews)
  const connectionService = new KiloConnectionService(context)

  // Create the provider with shared service
  const provider = new KiloProvider(context.extensionUri, connectionService)

  // Register the webview view provider for the sidebar
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(KiloProvider.viewType, provider))

  // Create Agent Manager provider for editor panel
  const agentManagerProvider = new AgentManagerProvider(context.extensionUri)
  context.subscriptions.push(agentManagerProvider)

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.plusButtonClicked", () => {
      provider.postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.marketplaceButtonClicked", () => {
      provider.postMessage({ type: "action", action: "marketplaceButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.historyButtonClicked", () => {
      provider.postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.profileButtonClicked", () => {
      provider.postMessage({ type: "action", action: "profileButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.settingsButtonClicked", () => {
      provider.postMessage({ type: "action", action: "settingsButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.openInTab", () => {
      return openKiloInNewTab(context, connectionService)
    }),
  )

  // Dispose service when extension deactivates (kills the server)
  context.subscriptions.push({
    dispose: () => {
      provider.dispose()
      connectionService.dispose()
    },
  })
}

export function deactivate() {}

async function openKiloInNewTab(context: vscode.ExtensionContext, connectionService: KiloConnectionService) {
  const lastCol = Math.max(...vscode.window.visibleTextEditors.map((e) => e.viewColumn || 0), 0)
  const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0

  if (!hasVisibleEditors) {
    await vscode.commands.executeCommand("workbench.action.newGroupRight")
  }

  const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

  const panel = vscode.window.createWebviewPanel("kilo-code.new.TabPanel", EXTENSION_DISPLAY_NAME, targetCol, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [context.extensionUri],
  })

  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-dark.svg"),
  }

  const tabProvider = new KiloProvider(context.extensionUri, connectionService)
  tabProvider.resolveWebviewPanel(panel)

  await new Promise((r) => setTimeout(r, 100))
  await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

  panel.onDidDispose(
    () => {
      console.log("[Kilo New] Tab panel disposed")
      tabProvider.dispose()
    },
    null,
    context.subscriptions,
  )
}
