import { homedir } from "node:os"
import {
  ColorThemeKind,
  commands,
  env,
  ExtensionMode,
  extensions,
  l10n,
  ProgressLocation,
  window,
  workspace,
  type ExtensionContext,
} from "vscode"
import { createAgentManagerConnection } from "./agent-manager/connection"
import { canonicalizePath, samePath } from "./agent-manager/project/paths"
import { DocumentViewerProvider } from "./DocumentViewerProvider"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { createPanel, PANEL_TYPE } from "./agent-manager/panel"
import { ensureCommandsSkipShell } from "./agent-manager/terminal-host"
import { VscodeHost } from "./agent-manager/vscode-host"
import { BrowserTabProvider } from "./browser-tab/BrowserTabProvider"
import { editorTabOwns, setEditorTabs, sidebarSession } from "./browser-tab/sidebar-session"
import { chat } from "./chat"
import { commitMessageCommand, commitMessageLanguage, connect, type GitExports } from "./commit-message"
import { createCostAlerts } from "./cost-alert"
import { command, manager, serverHome, settingsEnvironment } from "./server"
import { usePlanHome } from "./documents/document-reader"
import { readKiloSettings } from "./settings-host"
import { registerAutocompleteProvider } from "./services/autocomplete"
import { BrowserAutomationService, BrowserBroker } from "./services/browser-automation"
import {
  integratedBrowserEnabled,
  integratedBrowserFallback,
  integratedBrowserUseSystemChrome,
  migrateIntegratedBrowserUseSystemChrome,
} from "./services/browser-automation/chrome-setting"
import { createConnection } from "./services/autocomplete/connection"
import { profile } from "./profile-panel"
import { settings } from "./settings-panel"
import { createShutdown } from "./shutdown"
import type { BrowserReference } from "./shared/browser-feedback"
import { toolDiff } from "./tool-diff"
import { tabShortcutTarget } from "./tab-shortcuts"

let shutdownExtension: (() => Promise<void>) | undefined

export function activate(context: ExtensionContext) {
  const output = window.createOutputChannel("Kilo Code (v2)")
  const storage = context.globalStorageUri.fsPath
  const directory = workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir()
  const alerts = createCostAlerts({
    notify: async (alert) => {
      // This package ships no l10n bundles, so these strings remain English in every VS Code locale.
      const money = (value: number) =>
        value > 0 && value < 0.00000001 ? `$${value}` : `$${value.toFixed(value < 0.0001 ? 8 : value < 1 ? 4 : 2)}`
      const title = alert.title?.trim() || l10n.t("Session {0}", alert.sessionID.slice(-6))
      const keepGoing = l10n.t("Continue")
      const stop = l10n.t("Stop")
      const openSettings = l10n.t("Open Settings")
      const choice = await window.showWarningMessage(
        l10n.t(
          "{0}: session cost {1} has reached your {2} alert threshold. Keep going?",
          title,
          money(alert.cost),
          money(alert.limit),
        ),
        keepGoing,
        stop,
        openSettings,
      )
      if (choice === keepGoing) return "continue"
      if (choice === stop) return "stop"
      if (choice === openSettings)
        void commands.executeCommand("kilo-code.v2.settings", {
          tab: "autoApprove",
          titleKey: "settings.autoApprove.maxCost.title",
        })
      return undefined
    },
    onError: (error) => output.appendLine(`Cost alert: ${String(error)}`),
    onStopError: (sessionID, error) => {
      output.appendLine(`Cost alert: ${String(error)}`)
      const show = l10n.t("Show Output")
      void window
        .showErrorMessage(l10n.t("Could not stop session {0}. It may still be running.", sessionID.slice(-6)), show)
        .then((choice) => {
          if (choice === show) output.show()
        })
    },
  })
  alerts.setLimit(readKiloSettings().maxCost)

  void migrateIntegratedBrowserUseSystemChrome().catch((error: unknown) =>
    output.appendLine(`Integrated Browser Chrome preference migration failed: ${String(error)}`),
  )

  // The Integrated Browser runs one Chromium for every surface. The broker serves the browser_open tool over
  // loopback with a per-run token, and streams frames and input for the sidebar tab and the Agent Manager panel.
  const broker = new BrowserBroker({
    log: (...args) => output.appendLine(`Browser: ${args.map((item) => String(item)).join(" ")}`),
    enabled: integratedBrowserEnabled,
    trusted: () => workspace.isTrusted,
    useSystemChrome: integratedBrowserUseSystemChrome,
    fallback: () => process.platform === "linux" && integratedBrowserFallback(),
    theme: browserTheme,
  })
  context.subscriptions.push(
    window.onDidChangeActiveColorTheme(() => broker.retheme()),
    { dispose: () => broker.dispose() },
  )

  // Read at each start, so a settings change applies to the next server. The broker endpoint is set only while the
  // Integrated Browser is enabled, so a session sees the browser_open tool exactly when the feature is on.
  const serverSettings = async () => {
    const values = readKiloSettings()
    const browser =
      integratedBrowserEnabled() && workspace.isTrusted
        ? await broker.env().catch((error: unknown) => {
            output.appendLine(`Integrated Browser broker failed: ${String(error)}`)
            return {}
          })
        : {}
    return {
      ...settingsEnvironment({
        claudeCodeCompat: values.claudeCodeCompat === true,
        extraCaCerts: typeof values.extraCaCerts === "string" ? values.extraCaCerts : "",
      }),
      ...browser,
    }
  }
  const shutdown = createShutdown({ log: (text) => output.appendLine(text) })
  const serverCommand = () => command({ extension: context.extensionPath, storage, env: process.env })
  // Plan mode writes plans under the server's home, so plan links resolve there too.
  usePlanHome(serverHome(serverCommand(), process.env))
  const server = manager({
    command: serverCommand,
    cwd: directory,
    env: process.env,
    settings: serverSettings,
    log: (text) => output.append(text),
    // The autocomplete connection is declared below; the server starts only after activation returns.
    onStart: (started) => {
      shutdown.started(started)
      connection.started(started)
      alerts.start(started)
      autocomplete.started()
      void automation.started()
    },
    onStop: () => {
      shutdown.stopped()
      connection.stopped()
      alerts.stop()
      autocomplete.stopped()
      automation.stopped()
    },
    onError: (error) => {
      output.appendLine(error.message)
      void window.showErrorMessage(error.message.split("\n")[0], "Show Output").then((choice) => {
        if (choice) output.show()
      })
    },
  })
  const diffs = toolDiff()
  // Registers the optional Playwright MCP server in the v2 server. It is independent from the Integrated Browser.
  const automation = new BrowserAutomationService({
    server,
    log: (...args) => output.appendLine(`Browser automation: ${args.map((item) => String(item)).join(" ")}`),
  })
  void automation.syncWithSettings()
  context.subscriptions.push({ dispose: () => automation.dispose() })
  const connection = createAgentManagerConnection({ server })
  const autocomplete = createConnection({ server, directory })
  context.subscriptions.push({ dispose: autocomplete.dispose })
  registerAutocompleteProvider(context, autocomplete)
  let browserTab: BrowserTabProvider | undefined
  const documentsRef: { current?: DocumentViewerProvider } = {}
  const view = chat({
    context,
    server,
    directory,
    trackCostSession: alerts.track,
    diff: diffs,
    openBrowser: (sessionId, url) => browserTab?.openUrl(sessionId, url) ?? false,
    documents: () => documentsRef.current,
  })
  const documents = new DocumentViewerProvider({
    extension: context,
    directory,
    onComments: (comments, autoSend) => void view.post({ type: "appendReviewComments", comments, autoSend }),
  })
  documentsRef.current = documents
  // The Agent Manager binds first and skips the session the sidebar is showing and sessions with an open editor tab,
  // so a sidebar session opens the editor tab even when the panel has the same directory open.
  const agentHost = new VscodeHost(context, { server, directory })
  let agentManagerRef: AgentManagerProvider | undefined
  const agentPanel = createPanel({
    context,
    server,
    directory,
    trackCostSession: alerts.track,
    saveImageDirectory: () => agentManagerRef?.imageDirectory(),
  })
  const agentManager = new AgentManagerProvider(agentHost, connection, agentPanel, undefined, broker)
  agentManagerRef = agentManager
  agentManager.onBrowserDebug = (...args) => output.appendLine(`Browser AM: ${args.map((item) => String(item)).join(" ")}`)
  browserTab = new BrowserTabProvider(
    context.extensionUri,
    { browser: broker, version: (context.extension.packageJSON as { version?: string }).version },
    {
      enabled: () => integratedBrowserEnabled() && workspace.isTrusted,
      trusted: () => workspace.isTrusted,
      // The tab serves the session the sidebar shows, and keeps serving a session whose tab is still open.
      resolve: (route) =>
        editorTabOwns(route.sessionId) &&
        samePath(canonicalizePath(route.directory), canonicalizePath(directory))
          ? { sessionId: route.sessionId, directory: route.directory }
          : undefined,
      directory: () => directory,
      approve: async (_route, origin) => {
        if (!workspace.isTrusted) return false
        const allow = l10n.t("Allow")
        const answer = await window.showWarningMessage(
          l10n.t("Allow the Integrated Browser to navigate to {origin}?", { origin }),
          { modal: true },
          allow,
        )
        return answer === allow
      },
      reference: (_sessionId, value: BrowserReference) =>
        void view.post({ type: "browserReference", reference: value }),
      log: (...args) => output.appendLine(`Browser tab: ${args.map((item) => String(item)).join(" ")}`),
    },
  )
  setEditorTabs((sessionId) => browserTab?.has(sessionId) === true)
  context.subscriptions.push({ dispose: () => browserTab?.dispose() })
  // The Settings panel edits Agent Manager project settings through the provider's shared handler, so it is created
  // after the provider and receives a lazy getter.
  const panel = settings({
    context,
    server,
    directory,
    onReset: view.syncState,
    agentManager: () => agentManager.settings,
  })
  const profilePanel = profile({ context, server, directory })
  const agentAction = (action: string) => agentManager.postMessage({ type: "action", action })
  ensureCommandsSkipShell()
  // The cycle keybindings act on the focused composer: the Agent Manager panel when it is active, else the sidebar.
  // The panel receives an action, so an open dialog handles it before the session behind the dialog.
  const cycle = async (name: "cycleAgentMode" | "cyclePreviousAgentMode") => {
    if (agentManager.isActive()) return agentManager.postMessage({ type: "action", action: name })
    await commands.executeCommand("kilo-code.v2.chat.focus")
    await view.post({ type: "command", name })
  }
  const agentCommands = [
    ["previousSession", "sessionPrevious"],
    ["nextSession", "sessionNext"],
    ["previousTerminal", "terminalPrevious"],
    ["nextTerminal", "terminalNext"],
    ["search", "search"],
    ["showTerminal", "showTerminal"],
    ["runScript", "runScript"],
    ["toggleDiff", "toggleDiff"],
    ["showShortcuts", "showShortcuts"],
    ["newTab", "newTab"],
    ["newTerminalTab", "newTerminalTab"],
    ["newSideTerminal", "newSideTerminal"],
    ["closeTab", "closeTab"],
    ["newWorktree", "newWorktree"],
    ["quickWorktree", "quickWorktree"],
    ["openWorktree", "openWorktree"],
    ["updateFromBase", "updateFromBase"],
    ["openPR", "openPR"],
    ["closeWorktree", "closeWorktree"],
  ] as const

  context.subscriptions.push(
    output,
    { dispose: () => diffs.dispose() },
    workspace.registerTextDocumentContentProvider(diffs.scheme, diffs.provider),
    window.registerWebviewViewProvider("kilo-code.v2.chat", view.provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    commands.registerCommand("kilo-code.v2.newSession", async () => {
      await commands.executeCommand("kilo-code.v2.chat.focus")
      await view.post({ type: "command", name: "newSession" })
    }),
    commands.registerCommand("kilo-code.v2.history", async () => {
      await commands.executeCommand("kilo-code.v2.chat.focus")
      await view.post({ type: "command", name: "history" })
    }),
    commands.registerCommand("kilo-code.v2.profile", () => profilePanel.open()),
    // One shortcut pair serves the sidebar and the Agent Manager. The sidebar focus state is more precise than
    // `isActive`, which stays true while the panel is the selected editor tab but the sidebar has focus.
    commands.registerCommand("kilo-code.v2.agentManager.previousTab", () => {
      const target = tabShortcutTarget(view.focused(), agentManager.isActive())
      if (target === "sidebar") return void view.post({ type: "command", name: "tabPrevious" })
      if (target === "agentManager") return agentAction("tabPrevious")
    }),
    commands.registerCommand("kilo-code.v2.agentManager.nextTab", () => {
      const target = tabShortcutTarget(view.focused(), agentManager.isActive())
      if (target === "sidebar") return void view.post({ type: "command", name: "tabNext" })
      if (target === "agentManager") return agentAction("tabNext")
    }),
    // The switcher only exists in the sidebar, so the command always opens it there.
    commands.registerCommand("kilo-code.v2.showOpenTabs", async () => {
      await commands.executeCommand("kilo-code.v2.chat.focus")
      await view.post({ type: "command", name: "showOpenTabs" })
    }),
    commands.registerCommand("kilo-code.v2.settings", (...args: unknown[]) => panel.open(args)),
    commands.registerCommand("kilo-code.v2.settingsSearch", () => panel.open([{ search: true }])),
    panel,
    profilePanel,
    // The host sends the action and the webview decides the next agent, as in main: the agent list and
    // the selection live in the webview, and only the server owns the committed value.
    commands.registerCommand("kilo-code.v2.cycleAgentMode", () => cycle("cycleAgentMode")),
    commands.registerCommand("kilo-code.v2.cyclePreviousAgentMode", () => cycle("cyclePreviousAgentMode")),
    commands.registerCommand(
      "kilo-code.v2.generateCommitMessage",
      commitMessageCommand({
        git: () => extensions.getExtension<GitExports>("vscode.git"),
        window,
        location: ProgressLocation.SourceControl,
        language: () => {
          const config = workspace.getConfiguration("kilo-code.v2")
          return commitMessageLanguage(config.get("languageCommitMessage"), config.get("language"), env.language)
        },
        connect: () => connect(server),
        log: (text) => output.appendLine(text),
      }),
    ),
    // The webview reconnects on its own: its event stream fails, and the next request starts a new server.
    commands.registerCommand("kilo-code.v2.restartServer", () => server.stop()),
    commands.registerCommand("kilo-code.v2.openBrowser", () => browserTab?.openFor(sidebarSession())),
    // Claude Code compatibility and the extra CA certificates are server start environment, so a change needs a new
    // server. The next request starts one with the current settings.
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("kilo-code.v2.maxCost")) alerts.setLimit(readKiloSettings().maxCost)
      if (
        event.affectsConfiguration("kilo-code.v2.claudeCodeCompat") ||
        event.affectsConfiguration("kilo-code.v2.extraCaCerts") ||
        event.affectsConfiguration("kilo-code.v2.integratedBrowser")
      )
        void server.stop()
      if (event.affectsConfiguration("kilo-code.v2.integratedBrowser")) agentManager.browserAutomationChanged()
    }),
    window.registerWebviewPanelSerializer(PANEL_TYPE, {
      deserializeWebviewPanel: async (restored) => agentManager.deserializePanel(restored),
    }),
    documents,
    // A restored document tab reloads its own tabs from the messages it missed, so start it empty instead.
    window.registerWebviewPanelSerializer(DocumentViewerProvider.viewType, {
      deserializeWebviewPanel: async (restored) => restored.dispose(),
    }),
    commands.registerCommand("kilo-code.v2.agentManager.open", () => agentManager.openPanel()),
    commands.registerCommand("kilo-code.v2.agentManager.openInNewWindow", async () => {
      agentManager.openPanel()
      await commands.executeCommand("workbench.action.moveEditorToNewWindow")
    }),
    ...agentCommands.map(([command, action]) =>
      commands.registerCommand(`kilo-code.v2.agentManager.${command}`, () => agentAction(action)),
    ),
    ...Array.from({ length: 9 }, (_, index) =>
      commands.registerCommand(`kilo-code.v2.agentManager.jumpTo${index + 1}`, () => agentAction(`jumpTo${index + 1}`)),
    ),
    commands.registerCommand("kilo-code.v2.agentManager.advancedWorktree", () => agentManager.openAdvancedWorktree()),
    commands.registerCommand("kilo-code.v2.agentManager.diagnostics", () => {
      void agentManager.diagnose().catch((error: unknown) => {
        output.appendLine(`Agent Manager diagnostics failed: ${String(error)}`)
      })
    }),
    agentManager,
    { dispose: () => connection.dispose() },
    { dispose: () => void shutdown.run(() => server.stop()) },
    { dispose: alerts.dispose },
  )
  shutdownExtension = () => shutdown.run(() => server.stop())

  // `bun run extension` opens a development host: show the chat right away.
  if (context.extensionMode === ExtensionMode.Development) void commands.executeCommand("kilo-code.v2.chat.focus")
}

/** Current IDE color scheme, so the Integrated Browser matches the editor theme. */
function browserTheme(): "dark" | "light" {
  const kind = window.activeColorTheme.kind
  return kind === ColorThemeKind.Light || kind === ColorThemeKind.HighContrastLight ? "light" : "dark"
}

export function deactivate() {
  return shutdownExtension?.()
}
