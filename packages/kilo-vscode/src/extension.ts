import * as vscode from "vscode"
import { KiloProvider } from "./KiloProvider"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { KiloConnectionService } from "./services/cli-backend"
import { registerAutocompleteProvider } from "./services/autocomplete"
import { BrowserAutomationService } from "./services/browser-automation"

export function activate(context: vscode.ExtensionContext) {
  console.log("Kilo Code extension is now active")

  // Create shared connection service (one server for all webviews)
  const connectionService = new KiloConnectionService(context)

  // Create browser automation service (manages Playwright MCP registration)
  const browserAutomationService = new BrowserAutomationService(connectionService)
  browserAutomationService.syncWithSettings()

  // Re-register browser automation MCP server on CLI backend reconnect
  const unsubscribeStateChange = connectionService.onStateChange((state) => {
    if (state === "connected") {
      browserAutomationService.reregisterIfEnabled()
    }
  })

  // Create the provider with shared service
  const provider = new KiloProvider(context.extensionUri, connectionService)

  // Register the webview view provider for the sidebar.
  // retainContextWhenHidden keeps the webview alive when switching to other sidebar panels.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KiloProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // Create Agent Manager provider for editor panel
  const agentManagerProvider = new AgentManagerProvider(context.extensionUri, connectionService)
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

  // Register autocomplete provider
  registerAutocompleteProvider(context, connectionService)

  // Dispose services when extension deactivates (kills the server)
  context.subscriptions.push({
    dispose: () => {
      unsubscribeStateChange()
      browserAutomationService.dispose()
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

  // Wait for the new panel to become active before locking the editor group.
  // This avoids the race where VS Code hasn't switched focus yet.
  await waitForWebviewPanelToBeActive(panel)
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

function waitForWebviewPanelToBeActive(panel: vscode.WebviewPanel): Promise<void> {
  if (panel.active) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const disposable = panel.onDidChangeViewState((event) => {
      if (!event.webviewPanel.active) {
        return
      }
      disposable.dispose()
      resolve()
    })
  })
}
