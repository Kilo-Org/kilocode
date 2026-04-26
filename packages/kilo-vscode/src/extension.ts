import * as vscode from "vscode"
import { KiloProvider } from "./KiloProvider"
import type { DaveProviderExtensions } from "./KiloProvider.dave"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { VscodeHost } from "./agent-manager/vscode-host"
import { KiloClawProvider } from "./kiloclaw/KiloClawProvider"
import { DiffViewerProvider } from "./DiffViewerProvider"
import { DiffVirtualProvider } from "./DiffVirtualProvider"
import { SettingsEditorProvider } from "./SettingsEditorProvider"
import { SubAgentViewerProvider } from "./SubAgentViewerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { KiloConnectionService, HealthRecoveryService } from "./services/cli-backend"
import { registerAutocompleteProvider } from "./services/autocomplete"
import { ensureBackendForAutocomplete } from "./services/autocomplete/ensure-backend"
import { AutocompleteServiceManager } from "./services/autocomplete/AutocompleteServiceManager"
import { BrowserAutomationService } from "./services/browser-automation"
import { TelemetryProxy } from "./services/telemetry"
import { registerCommitMessageService } from "./services/commit-message"
import { registerCodeActions, registerTerminalActions, KiloCodeActionProvider } from "./services/code-actions"
import { registerToggleAutoApprove } from "./commands/toggle-auto-approve"
import { registerHeapSnapshot } from "./commands/heap-snapshot"
import { RemoteStatusService } from "./services/RemoteStatusService"
import { HermesClient, HermesPipeline, HermesStatusService, buildPreset, HERMES_PROVIDER_ID } from "./services/hermes"
import { registerHermesCommands } from "./commands/hermes"
import { SSHService } from "./services/ssh"
import { VPSService } from "./services/vps"
import { ZeroClawService } from "./services/zeroclaw"
import { RoutingService } from "./services/routing"
import { MemoryService } from "./services/memory"
import { TrainingService } from "./services/training"
import { GovernanceService } from "./services/governance"
import { WorkstationProfileService } from "./services/workstation"
import type { KiloClient } from "@kilocode/sdk/v2"
import { KiloLogger } from "./services/KiloLogger"
import { HubPanel } from "./panels/HubPanel"
import { HubServicesService } from "./services/hub-services"

// Activated via "onStartupFinished" (package.json) so that commands, code actions, keybindings,
// autocomplete, commit-message generation, and URI deep links all work immediately — without
// requiring the user to open a Kilo sidebar or panel first. The CLI backend is NOT spawned here;
// it starts lazily when a webview connects or when ensureBackendForAutocomplete() triggers it.
export function activate(context: vscode.ExtensionContext) {
  // Initialize centralized V4 logging (OutputChannel + debug mode toggle)
  KiloLogger.initialize()
  const extLog = KiloLogger.for("Extension")
  extLog.info("Kilo Code extension activating")

  // Register debug mode toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.v4.toggleDebugMode", async () => {
      const current = KiloLogger.isDebugMode
      await KiloLogger.setDebugMode(!current)
      KiloLogger.showChannel()
      vscode.window.showInformationMessage(
        `KiloCode V4 Debug Mode ${!current ? "ENABLED" : "DISABLED"}`,
      )
    }),
  )

  // Register onboarding wizard command — allows re-running wizard anytime
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.v4.runOnboardingWizard", async () => {
      await context.globalState.update("kilocode.profile.onboardingComplete", false)
      vscode.window.showInformationMessage(
        "KiloCode: Onboarding wizard will open on next sidebar view.",
      )
    }),
  )

  const telemetry = TelemetryProxy.getInstance()

  // Create shared connection service (one server for all webviews)
  const connectionService = new KiloConnectionService(context)

  // Create CLI backend health recovery service — monitors CLI, auto-reconnects with backoff,
  // exposes status bar indicator. Fixes the "CLI Server: Error" state with no auto-recovery.
  try {
    const healthRecovery = new HealthRecoveryService(connectionService, context)
    healthRecovery.start()
    context.subscriptions.push(healthRecovery)
  } catch (err) {
    extLog.warn("Failed to start CLI HealthRecoveryService", err)
  }

  // Create browser automation service (manages Playwright MCP registration)
  const browserAutomationService = new BrowserAutomationService(connectionService)
  browserAutomationService.syncWithSettings()

  // Create remote status service (one status bar item for all webviews)
  const remoteService = new RemoteStatusService()
  context.subscriptions.push(remoteService)
  connectionService.setRemoteService(remoteService)

  // Create Hermes pipeline services (disabled by default; zero cost when off).
  // See docs/KILOCODE-HERMES-ZEROCLAW-PIPELINE.md for architecture.
  const hermesStatus = new HermesStatusService(context)
  context.subscriptions.push(hermesStatus)
  const hermesClient = new HermesClient(context, hermesStatus.getConfig())
  hermesStatus.setClient(hermesClient)
  const hermesPipeline = new HermesPipeline(context, hermesStatus, hermesClient)
  context.subscriptions.push(hermesPipeline)
  registerHermesCommands(context, hermesStatus, hermesClient, hermesPipeline)

  // Create V4 subsystem services.
  // Each service is self-contained, persists its own state, and implements vscode.Disposable.
  const sshService = new SSHService(context)
  context.subscriptions.push(sshService)

  const vpsService = new VPSService(context)
  context.subscriptions.push(vpsService)

  const zeroClawService = new ZeroClawService(context)
  context.subscriptions.push(zeroClawService)

  const routingService = new RoutingService(context)
  context.subscriptions.push(routingService)

  const memoryService = new MemoryService(context)
  context.subscriptions.push(memoryService)

  const trainingService = new TrainingService(context)
  context.subscriptions.push(trainingService)

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""
  const governanceService = new GovernanceService(workspaceRoot)
  context.subscriptions.push(governanceService)

  const workstationProfile = new WorkstationProfileService()
  context.subscriptions.push(workstationProfile)

  // Auto-discovery — created here, wired into providers, started after setV4Services.
  // Import is dynamic so the onboarding bundle is only loaded when the module exists.
  let discoveryService: import("./services/onboarding").OnboardingDiscoveryService | undefined

  // Register all V4 subsystems with governance for adversarial audit coverage
  governanceService.registerSubsystem("governance", "active")
  governanceService.registerSubsystem("ssh", "active")
  governanceService.registerSubsystem("vps", "active")
  governanceService.registerSubsystem("zeroClaw", "active")
  governanceService.registerSubsystem("routing", "active")
  governanceService.registerSubsystem("memory", "active")
  governanceService.registerSubsystem("training", "active")
  governanceService.registerSubsystem("workstation", "active")
  governanceService.registerSubsystem("hermes", "active")
  governanceService.registerSubsystem("speech", "active")
  governanceService.registerSubsystem("onboarding", "active")
  governanceService.registerSubsystem("hubServices", "active")

  // Hub service lifecycle watchdog — probes /api/services/* on activation and
  // every poll interval. Auto-starts services that have a registered start_cmd.
  // Status bar item shows "DaveAI: N/M" with click-to-restart quick-pick.
  let hubServices: HubServicesService | undefined
  try {
    hubServices = new HubServicesService(context)
    context.subscriptions.push(hubServices)
    hubServices.start()
  } catch (err) {
    extLog.warn("Failed to start HubServicesService", err)
  }

  // Sync the Hermes provider preset into the CLI backend config on toggle.
  // Runs once on toggle and once on each CLI reconnect (in case Hermes was
  // already enabled before the backend started).
  const syncHermesPreset = async (client: KiloClient, enabled: boolean, baseUrl: string) => {
    try {
      const globalCfg = (await client.global.config.get({ throwOnError: true })).data ?? {}
      const disabled: string[] = (globalCfg as { disabled_providers?: string[] }).disabled_providers ?? []
      if (enabled) {
        const preset = buildPreset(baseUrl)
        const nextDisabled = disabled.filter((id) => id !== HERMES_PROVIDER_ID)
        await client.global.config.update(
          { config: { provider: { [HERMES_PROVIDER_ID]: preset as unknown as Record<string, unknown> }, disabled_providers: nextDisabled } },
          { throwOnError: true },
        )
        console.log("[Kilo Hermes] Provider preset written to CLI config")
      } else {
        if (disabled.includes(HERMES_PROVIDER_ID)) return
        await client.global.config.update(
          { config: { disabled_providers: [...disabled, HERMES_PROVIDER_ID] } },
          { throwOnError: true },
        )
        console.log("[Kilo Hermes] Provider preset disabled in CLI config")
      }
    } catch (err) {
      console.warn("[Kilo Hermes] syncHermesPreset failed (non-fatal):", err)
    }
  }

  hermesStatus.onChange(async (cfg) => {
    try {
      const client = connectionService.getClient()
      await syncHermesPreset(client, cfg.enabled, cfg.baseUrl)
    } catch {
      // CLI not yet connected — will be applied on next connectionService onStateChange
    }
  })

  // Re-register browser automation MCP server on CLI backend reconnect, configure telemetry,
  // set remote service client, and reload autocomplete so it picks up the now-available backend connection.
  const unsubscribeStateChange = connectionService.onStateChange((state) => {
    if (state === "connected") {
      browserAutomationService.reregisterIfEnabled()
      const config = connectionService.getServerConfig()
      if (config) {
        telemetry.configure(config.baseUrl, config.password)
      }
      try {
        remoteService.setClient(connectionService.getClient())
        console.log("[Kilo New] CLI connected, calling remoteService.refresh()")
        remoteService.refresh().catch((err) => console.warn("[Kilo New] initial remote refresh failed:", err))
      } catch {
        remoteService.setClient(null)
      }
      AutocompleteServiceManager.getInstance()?.load()
      // Apply Hermes preset if it was toggled on before the CLI connected.
      const hermesCfg = hermesStatus.getConfig()
      void syncHermesPreset(connectionService.getClient(), hermesCfg.enabled, hermesCfg.baseUrl)
    } else {
      remoteService.clearState()
      remoteService.setClient(null)
    }
  })

  // Prewarm the CLI backend early so autocomplete is ready before first editor use.
  ensureBackendForAutocomplete(connectionService)

  // Track all open tab panel providers so toolbar button commands can target them.
  // NOTE: The editor/title toolbar for tab panels intentionally omits Agent Manager
  // and Marketplace buttons (unlike the sidebar). Too many icons causes VS Code to
  // collapse them into a "..." overflow menu, hiding important buttons like Settings.
  const tabPanels = new Map<vscode.WebviewPanel, KiloProvider>()
  const activeTabProvider = () => {
    for (const [panel, p] of tabPanels) {
      if (panel.active) return p
    }
    return undefined
  }

  // Create the provider with shared service
  const provider = new KiloProvider(context.extensionUri, connectionService, context)
  provider.setRemoteService(remoteService)
  ;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setHermesServices(hermesStatus, hermesClient)
  ;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services({
    ssh: sshService,
    vps: vpsService,
    zeroClaw: zeroClawService,
    routing: routingService,
    memory: memoryService,
    training: trainingService,
    governance: governanceService,
    workstation: workstationProfile,
    discovery: discoveryService,
  })

  // Run discovery in background (don't block activation).
  // Dynamic import so the onboarding bundle is only pulled when the module ships.
  void import("./services/onboarding").then(({ OnboardingDiscoveryService }) => {
    discoveryService = new OnboardingDiscoveryService(context)
    context.subscriptions.push(discoveryService)

    // Wire into all existing providers so tabs can request results
    const v4WithDiscovery = {
      ssh: sshService,
      vps: vpsService,
      zeroClaw: zeroClawService,
      routing: routingService,
      memory: memoryService,
      training: trainingService,
      governance: governanceService,
      workstation: workstationProfile,
      discovery: discoveryService,
    }
    ;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services(v4WithDiscovery)
    settingsEditorProvider.setV4Services(v4WithDiscovery)

    discoveryService.runFullDiscovery().then(async (result) => {
      console.log(
        "[Kilo New] Discovery complete:",
        result.providers.ollama.available ? "Ollama" : "",
        result.providers.lmstudio.available ? "LM Studio" : "",
        result.gpu.detected ? result.gpu.name : "No GPU",
        `SSH hosts: ${result.sshProfiles.length}`,
      )

      // Auto-test local providers that discovery found available
      if (result.providers.ollama.available) {
        await routingService.testProvider("ollama").catch(() => {})
      }
      if (result.providers.lmstudio.available) {
        await routingService.testProvider("lmstudio").catch(() => {})
      }

      // Pre-populate GPU detection for TrainingTab
      if (result.gpu.detected && trainingService) {
        await trainingService.detectGPUs().catch(() => {})
      }

      // CRITICAL: Import SSH profiles from ~/.ssh/config into SSHService
      // so the SSH tab shows real profiles instead of empty list
      try {
        const importedProfiles = await sshService.importFromSSHConfig()
        if (importedProfiles.length > 0) {
          console.log(`[Kilo New] Auto-imported ${importedProfiles.length} SSH profiles from ~/.ssh/config`)
        }
      } catch (err) {
        console.warn("[Kilo New] SSH auto-import failed (non-fatal):", err)
      }

      // Notify all open webviews that discovery is complete so they can refresh
      // Provider will broadcast to all registered webviews (sidebar + tab panels)
      ;(provider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.broadcastDiscoveryComplete?.(result)
    }).catch((err) => {
      console.warn("[Kilo New] Background discovery failed (non-fatal):", err)
    })
  }).catch(() => {
    // Module doesn't exist yet — another agent is creating it. Silently skip.
    console.log("[Kilo New] Onboarding discovery module not yet available, skipping")
  })

  // Register the webview view provider for the sidebar.
  // retainContextWhenHidden keeps the webview alive when switching to other sidebar panels.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KiloProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // Ensure Agent Manager navigation keybindings work when a VS Code terminal has focus.
  // The terminal intercepts all keystrokes unless the command is listed in
  // terminal.integrated.commandsToSkipShell, which only contains built-in
  // commands by default.
  const skip = ["kilo-code.new.agentManagerOpen", "kilo-code.new.agentManager.showTerminal"]
  if (process.platform === "darwin") skip.push("kilo-code.new.agentManager.runScript")
  ensureCommandsSkipShell(skip)

  // Create KiloClaw chat provider for editor panel
  const kiloClawProvider = new KiloClawProvider(context.extensionUri, connectionService)
  context.subscriptions.push(kiloClawProvider)

  // Create Agent Manager provider for editor panel
  const agentManagerHost = new VscodeHost(context.extensionUri, connectionService, context)
  const agentManagerProvider = new AgentManagerProvider(agentManagerHost, connectionService)
  context.subscriptions.push(agentManagerProvider)

  // Wire "Continue in Worktree" from sidebar → Agent Manager
  provider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )

  // Register serializer so Agent Manager restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(AgentManagerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        const ctx = agentManagerHost.wrapExistingPanel(panel, {
          onBeforeMessage: (msg) => agentManagerProvider.handleMessage(msg),
        })
        agentManagerProvider.deserializePanel(ctx)
        return Promise.resolve()
      },
    }),
  )

  // Register serializer so KiloClaw panel restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(KiloClawProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        kiloClawProvider.restorePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  // Register serializer so "Open in Tab" restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("kilo-code.new.TabPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        const tabProvider = new KiloProvider(context.extensionUri, connectionService, context)
        tabProvider.setRemoteService(remoteService)
        ;(tabProvider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setHermesServices(hermesStatus, hermesClient)
        ;(tabProvider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services({
          ssh: sshService,
          vps: vpsService,
          zeroClaw: zeroClawService,
          routing: routingService,
          memory: memoryService,
          training: trainingService,
          governance: governanceService,
          workstation: workstationProfile,
          discovery: discoveryService,
        })
        tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
          agentManagerProvider.continueFromSidebar(sessionId, progress),
        )
        tabProvider.setDiffVirtualProvider(diffVirtualProvider)
        tabProvider.resolveWebviewPanel(panel)
        tabPanels.set(panel, tabProvider)
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

  // Create standalone diff viewer provider for the sidebar "Show Changes" action
  const diffViewerProvider = new DiffViewerProvider(context.extensionUri, connectionService)
  diffViewerProvider.setCommentHandler((comments, autoSend) => {
    void provider.appendReviewComments(comments, autoSend)
  })
  context.subscriptions.push(diffViewerProvider)

  // Create diff virtual provider (lightweight single-file diff for permission approval)
  const diffVirtualProvider = new DiffVirtualProvider(context.extensionUri)
  provider.setDiffVirtualProvider(diffVirtualProvider)
  agentManagerHost.setDiffVirtualProvider(diffVirtualProvider)
  context.subscriptions.push(diffVirtualProvider)

  // Create settings/profile editor provider (opens in editor area, not sidebar)
  const settingsEditorProvider = new SettingsEditorProvider(context.extensionUri, connectionService, context)
  settingsEditorProvider.setRemoteService(remoteService)
  settingsEditorProvider.setHermesServices(hermesStatus, hermesClient)
  settingsEditorProvider.setV4Services({
    ssh: sshService,
    vps: vpsService,
    zeroClaw: zeroClawService,
    routing: routingService,
    memory: memoryService,
    training: trainingService,
    governance: governanceService,
    workstation: workstationProfile,
    discovery: discoveryService,
  })
  context.subscriptions.push(settingsEditorProvider)

  // Create sub-agent viewer provider (read-only editor panel for sub-agent sessions)
  const subAgentViewerProvider = new SubAgentViewerProvider(context.extensionUri, connectionService, context)
  context.subscriptions.push(subAgentViewerProvider)

  // Register serializers so settings/diff/sub-agent panels restore on restart
  const settingsViews = ["settingsPanel", "profilePanel", "marketplacePanel"] as const
  for (const suffix of settingsViews) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(`kilo-code.new.${suffix}`, {
        deserializeWebviewPanel(panel: vscode.WebviewPanel) {
          settingsEditorProvider.deserializePanel(panel)
          return Promise.resolve()
        },
      }),
    )
  }

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DiffViewerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        diffViewerProvider.deserializePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("kilo-code.new.SubAgentViewerPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        // Sub-agent viewer requires a session ID that can't be recovered
        // after restart, so dispose the stale panel cleanly.
        panel.dispose()
        return Promise.resolve()
      },
    }),
  )

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.plusButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "plusButtonClicked" })
      else provider.postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.marketplaceButtonClicked", (directory?: string) => {
      settingsEditorProvider.openPanel("marketplace", undefined, directory)
    }),
    vscode.commands.registerCommand("kilo-code.new.kiloClawOpen", () => {
      kiloClawProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.hub.open", () => {
      HubPanel.open(context)
    }),
    vscode.commands.registerCommand("kilo-code.new.historyButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "historyButtonClicked" })
      else provider.postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.cycleAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cycleAgentMode" })
      else provider.postMessage({ type: "action", action: "cycleAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cycleAgentMode" })
    }),
    vscode.commands.registerCommand("kilo-code.new.cyclePreviousAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      else provider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
    }),
    vscode.commands.registerCommand("kilo-code.new.profileButtonClicked", () => {
      settingsEditorProvider.openPanel("profile")
    }),
    vscode.commands.registerCommand("kilo-code.new.settingsButtonClicked", (tab?: string) => {
      settingsEditorProvider.openPanel("settings", tab)
    }),
    // legacy-migration start
    vscode.commands.registerCommand("kilo-code.new.openMigrationWizard", () => {
      provider.postMessage({ type: "migrationState", needed: true })
    }),
    // legacy-migration end
    vscode.commands.registerCommand("kilo-code.new.generateTerminalCommand", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Describe the terminal command you want to generate",
        placeHolder: "e.g., find all .ts files modified in the last 24 hours",
      })
      if (!input) return
      await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
      await provider.waitForReady()
      provider.postMessage({ type: "triggerTask", text: `Generate a terminal command: ${input}` })
    }),
    vscode.commands.registerCommand("kilo-code.new.toggleRemote", () => {
      remoteService.toggle().catch((err) => console.error("[Kilo New] toggleRemote command failed:", err))
    }),
    vscode.commands.registerCommand("kilo-code.new.openInTab", () => {
      return openKiloInNewTab(
        context,
        connectionService,
        agentManagerProvider,
        tabPanels,
        diffVirtualProvider,
        remoteService,
        { ssh: sshService, vps: vpsService, zeroClaw: zeroClawService, routing: routingService, memory: memoryService, training: trainingService, governance: governanceService, workstation: workstationProfile, discovery: discoveryService },
        hermesStatus,
        hermesClient,
      )
    }),
    vscode.commands.registerCommand("kilo-code.new.showChanges", () => {
      diffViewerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.openSubAgentViewer", (sessionID: string, title?: string) => {
      subAgentViewerProvider.openPanel(sessionID, title)
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.previousSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionPrevious" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.nextSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionNext" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.previousTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabPrevious" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.nextTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabNext" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.showTerminal", () => {
      // Route through the webview so it can reach into the active session
      // state and open the VS Code integrated terminal for it.
      agentManagerProvider.postMessage({ type: "action", action: "showTerminal" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.runScript", () => {
      agentManagerProvider.postMessage({ type: "action", action: "runScript" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.toggleDiff", () => {
      agentManagerProvider.postMessage({ type: "action", action: "toggleDiff" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.showShortcuts", () => {
      agentManagerProvider.postMessage({ type: "action", action: "showShortcuts" })
    }),

    vscode.commands.registerCommand("kilo-code.new.agentManager.newTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTab" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.newTerminal", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTerminal" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.closeTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeTab" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.newWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.openWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "openWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.closeWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.advancedWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "advancedWorktree" })
    }),
    ...Array.from({ length: 9 }, (_, i) =>
      vscode.commands.registerCommand(`kilo-code.new.agentManager.jumpTo${i + 1}`, () => {
        agentManagerProvider.postMessage({ type: "action", action: `jumpTo${i + 1}` })
      }),
    ),
  )

  // Register URI handler for session imports (vscode://kilocode.kilo-code/kilocode/s/{sessionId})
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        const match = uri.path.match(/^\/kilocode\/s\/([a-zA-Z0-9_-]+)$/)
        if (!match) return
        const sessionId = match[1]
        if (!sessionId) return
        console.log("[Kilo New] URI handler: opening cloud session:", sessionId)
        await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
        provider.openCloudSession(sessionId)
      },
    }),
  )

  // Register autocomplete provider
  registerAutocompleteProvider(context, connectionService)

  // Register commit message generation
  registerCommitMessageService(context, connectionService)

  // Register toggle auto-approve shortcut (Ctrl+Alt+A / Cmd+Alt+A)
  const defaultDir = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  registerToggleAutoApprove(
    context,
    connectionService,
    (sessionId) => {
      if (sessionId) {
        const dir =
          provider.getSessionDirectories().get(sessionId) ?? agentManagerProvider.getSessionDirectories().get(sessionId)
        if (dir) return dir
      }
      return defaultDir()
    },
    () => {
      const dirs = new Set([defaultDir()])
      for (const dir of provider.getSessionDirectories().values()) dirs.add(dir)
      for (const dir of agentManagerProvider.getSessionDirectories().values()) dirs.add(dir)
      return [...dirs]
    },
  )

  registerHeapSnapshot(context, connectionService)

  // Register code actions (editor context menus, terminal context menus, keyboard shortcuts)
  registerCodeActions(context, provider, agentManagerProvider)
  registerTerminalActions(context, provider, agentManagerProvider)

  // Register CodeActionProvider (lightbulb quick fixes)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new KiloCodeActionProvider(),
      KiloCodeActionProvider.metadata,
    ),
  )

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

export function deactivate() {
  TelemetryProxy.getInstance().shutdown()
}

async function openKiloInNewTab(
  context: vscode.ExtensionContext,
  connectionService: KiloConnectionService,
  agentManagerProvider: AgentManagerProvider,
  tabPanels: Map<vscode.WebviewPanel, KiloProvider>,
  diffVirtualProvider: DiffVirtualProvider,
  remoteService: RemoteStatusService,
  v4Services: Parameters<DaveProviderExtensions["setV4Services"]>[0],
  hermesStatusArg?: import("./services/hermes").HermesStatusService,
  hermesClientArg?: import("./services/hermes").HermesClient,
) {
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

  const tabProvider = new KiloProvider(context.extensionUri, connectionService, context)
  tabProvider.setRemoteService(remoteService)
  if (hermesStatusArg && hermesClientArg) (tabProvider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setHermesServices(hermesStatusArg, hermesClientArg)
  ;(tabProvider as unknown as { __daveExtensions?: DaveProviderExtensions }).__daveExtensions?.setV4Services(v4Services)
  tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )
  tabProvider.setDiffVirtualProvider(diffVirtualProvider)
  tabProvider.resolveWebviewPanel(panel)
  tabPanels.set(panel, tabProvider)

  // Wait for the new panel to become active before locking the editor group.
  // This avoids the race where VS Code hasn't switched focus yet.
  await waitForWebviewPanelToBeActive(panel)
  await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

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

/**
 * Add extension commands to terminal.integrated.commandsToSkipShell so they
 * work when a VS Code terminal has focus. The setting only ships with built-in
 * commands; extension commands must be added explicitly.
 */
function ensureCommandsSkipShell(commands: string[]): void {
  const config = vscode.workspace.getConfiguration("terminal.integrated")
  const info = config.inspect<string[]>("commandsToSkipShell")
  // Update whichever scope already carries an override so we don't
  // shadow workspace settings or leak workspace values into global.
  const [existing, target] = info?.workspaceFolderValue
    ? [info.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
    : info?.workspaceValue
      ? [info.workspaceValue, vscode.ConfigurationTarget.Workspace]
      : [info?.globalValue ?? [], vscode.ConfigurationTarget.Global]
  const missing = commands.filter((cmd) => !existing.includes(cmd))
  if (missing.length === 0) return
  config.update("commandsToSkipShell", [...existing, ...missing], target)
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
