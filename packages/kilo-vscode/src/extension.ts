import * as vscode from "vscode"
import { KiloProvider } from "./KiloProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { KiloConnectionService } from "./services/cli-backend"
import { closeTaskTarget, SurfaceFocus } from "./commands/close-task-target"
import { isCursorHost } from "./utils"
import { flags } from "./features"

const panelTitleHandler = (panel: vscode.WebviewPanel) => (title: string) => {
  panel.title = title || EXTENSION_DISPLAY_NAME
}

// Activated via "onStartupFinished" and "onUri" (package.json) so that commands, keybindings and URI deep links work
// immediately, without requiring the user to open a Kilo sidebar or panel first. The Kilo v2 server is NOT spawned
// here; it starts lazily when a webview connects.
//
// On the v2 line only the chat path is wired. Features outside chat are off (see features.ts) and their code is not
// part of this package yet.
export async function activate(context: vscode.ExtensionContext) {
  console.log("Kilo Code extension is now active")

  // Drives the "!kilo-code.new.isCursor" guards on the native view/title and
  // editor/title menu contributions, see isCursorHost() for why.
  void vscode.commands.executeCommand("setContext", "kilo-code.new.isCursor", isCursorHost())
  // Drives the `when` clauses of title buttons and commands that belong to features that are off.
  for (const [name, on] of Object.entries(flags)) {
    void vscode.commands.executeCommand("setContext", `kilo-code.new.feature.${name}`, on)
  }

  // Create shared connection service (one server for all webviews)
  const connectionService = new KiloConnectionService(context)

  // Track all open tab panel providers so toolbar button commands can target them.
  const tabPanels = new Map<vscode.WebviewPanel, KiloProvider>()
  const activeTabProvider = () => {
    for (const [panel, p] of tabPanels) {
      if (panel.active) return p
    }
    return undefined
  }

  // Tracks the Kilo surface the user last worked in, so commands invoked from
  // the Command Palette still know where to act after it takes focus away.
  const focus = new SurfaceFocus()

  // Create the provider with shared service
  const provider = new KiloProvider(context.extensionUri, connectionService, context, {
    focusContext: "kilo-code.new.sidebarFocused",
    onFocused: () => focus.gained("sidebar"),
    onHidden: () => focus.lost("sidebar"),
  })

  // Register the webview view provider for the sidebar.
  // retainContextWhenHidden keeps the webview alive when switching to other sidebar panels.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KiloProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  const attach = (panel: vscode.WebviewPanel) => {
    const tabProvider = new KiloProvider(context.extensionUri, connectionService, context, {
      tabTitle: panelTitleHandler(panel),
      topBarSurface: "tab",
      onFocused: () => focus.gained("tab"),
      onHidden: () => focus.lost("tab"),
    })
    tabProvider.resolveWebviewPanel(panel)
    tabPanels.set(panel, tabProvider)
    return tabProvider
  }

  // Register serializer so "Open in Tab" restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("kilo-code.new.TabPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        const tabProvider = attach(panel)
        panel.onDidDispose(
          () => {
            console.log("[Kilo New] Tab panel restored from restart disposed")
            tabPanels.delete(panel)
            tabProvider.dispose()
          },
          null,
          context.subscriptions,
        )
        return Promise.resolve()
      },
    }),
  )

  // Task-close commands stop work on whichever surface the user is on, so they
  // resolve their target from the last focused surface rather than from panel
  // activation alone.
  const taskTarget = () =>
    closeTaskTarget<KiloProvider>({
      focused: focus.current(),
      sidebar: provider,
      tab: activeTabProvider(),
    })

  const current = () => activeTabProvider() ?? provider
  const reveal = async () => {
    if (activeTabProvider()) return
    await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
    await provider.waitForReady()
  }

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.sidebarTitle.plusButtonClicked", () => {
      void vscode.commands.executeCommand("kilo-code.new.plusButtonClicked")
    }),
    vscode.commands.registerCommand("kilo-code.new.sidebarTitle.historyButtonClicked", () => {
      void vscode.commands.executeCommand("kilo-code.new.historyButtonClicked")
    }),
    vscode.commands.registerCommand("kilo-code.new.plusButtonClicked", () => {
      current().postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.closeTask", () => {
      taskTarget().postMessage({ type: "action", action: "closeTask" })
    }),
    vscode.commands.registerCommand("kilo-code.new.closeAllTasks", () => {
      taskTarget().postMessage({ type: "action", action: "closeAllTasks" })
    }),
    vscode.commands.registerCommand("kilo-code.new.historyButtonClicked", () => {
      current().postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.sidebarTitle.profileButtonClicked", () => {
      void vscode.commands.executeCommand("kilo-code.new.profileButtonClicked")
    }),
    // On v1 the profile opened in a dedicated panel. That panel belongs to the settings editor, which is off on the
    // Kilo v2 line, so the chat view shows its own profile view.
    vscode.commands.registerCommand("kilo-code.new.profileButtonClicked", () => {
      current().postMessage({ type: "action", action: "profileButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.focusChatInput", async () => {
      await reveal()
      current().postMessage({ type: "action", action: "focusInput" })
    }),
    vscode.commands.registerCommand("kilo-code.new.toggleChatSearch", async () => {
      await reveal()
      current().postMessage({ type: "action", action: "focusSearch" })
    }),
    vscode.commands.registerCommand("kilo-code.new.cycleAgentMode", () => {
      current().postMessage({ type: "action", action: "cycleAgentMode" })
    }),
    vscode.commands.registerCommand("kilo-code.new.cyclePreviousAgentMode", () => {
      current().postMessage({ type: "action", action: "cyclePreviousAgentMode" })
    }),
    vscode.commands.registerCommand("kilo-code.new.openInTab", () => {
      return openKiloInNewTab(context, tabPanels, attach)
    }),
    // One shortcut pair serves the sidebar and Kilo editor tabs. Every surface receives the action and acts only
    // while it has focus, matching cycleAgentMode.
    vscode.commands.registerCommand("kilo-code.new.agentManager.previousTab", () => {
      activeTabProvider()?.postMessage({ type: "action", action: "tabPrevious" })
      provider.postMessage({ type: "action", action: "tabPrevious" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.nextTab", () => {
      activeTabProvider()?.postMessage({ type: "action", action: "tabNext" })
      provider.postMessage({ type: "action", action: "tabNext" })
    }),
    vscode.commands.registerCommand("kilo-code.new.reload", () => {
      provider.reload().catch((e) => console.error("[Kilo New] reload command failed:", e))
    }),
  )

  // Register URI handler for extension deep links (vscode://kilocode.kilo-code/kilocode/...)
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (uri.path !== "/kilocode/switch" && uri.path !== "/kilocode/model") return
        const params = new URLSearchParams(uri.query)
        const modelID = params.get("model") || undefined
        const agent = params.get("agent") || undefined
        if (!modelID && !agent) return
        console.log("[Kilo New] URI handler: applying linked Kilo selection:", { modelID, agent })
        await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
        provider.selectKiloModel(modelID, agent)
      },
    }),
  )

  // Dispose services when extension deactivates (stops the server)
  context.subscriptions.push({
    dispose: () => {
      provider.dispose()
      connectionService.dispose()
    },
  })
}

export async function deactivate() {}

function openKiloInNewTab(
  context: vscode.ExtensionContext,
  tabPanels: Map<vscode.WebviewPanel, KiloProvider>,
  attach: (panel: vscode.WebviewPanel) => KiloProvider,
) {
  const panel = vscode.window.createWebviewPanel(
    "kilo-code.new.TabPanel",
    EXTENSION_DISPLAY_NAME,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    },
  )

  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-dark.svg"),
  }

  const tabProvider = attach(panel)

  panel.onDidDispose(
    () => {
      console.log("[Kilo New] Tab panel disposed")
      tabPanels.delete(panel)
      tabProvider.dispose()
    },
    null,
    context.subscriptions,
  )
}
