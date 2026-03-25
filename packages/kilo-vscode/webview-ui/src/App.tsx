import { Component, createSignal, createMemo, Switch, Match, onMount, onCleanup } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { Toast } from "@kilocode/kilo-ui/toast"
import Settings from "./components/settings/Settings"
import ProfileView from "./components/profile/ProfileView"
import { VSCodeProvider, useVSCode } from "./context/vscode"
import { ServerProvider, useServer } from "./context/server"
import { ProviderProvider, useProvider } from "./context/provider"
import { ConfigProvider } from "./context/config"
import { SessionProvider, useSession } from "./context/session"
import { LanguageProvider } from "./context/language"
import { ChatView } from "./components/chat"
import { MarketplaceView } from "./components/marketplace"
import { registerExpandedTaskTool } from "./components/chat/TaskToolExpanded"
import { registerVscodeToolOverrides } from "./components/chat/VscodeToolOverrides"

// Override the upstream "task" tool renderer with the fully-expanded version
// that shows child session parts inline in the VS Code sidebar.
registerExpandedTaskTool()
// Apply VS Code sidebar preferences to other tools (e.g. bash expanded by default).
registerVscodeToolOverrides()
import SessionList from "./components/history/SessionList"
import CloudSessionList from "./components/history/CloudSessionList"
import { MigrationWizard } from "./components/migration" // legacy-migration
import { NotificationsProvider } from "./context/notifications"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import "./styles/chat.css"

type ViewType =
  | "newTask"
  | "marketplace"
  | "history"
  | "cloudHistory"
  | "profile"
  | "settings"
  | "migration" // legacy-migration
  | "subAgentViewer"
const VALID_VIEWS = new Set<string>([
  "newTask",
  "marketplace",
  "history",
  "cloudHistory",
  "profile",
  "settings",
  "migration", // legacy-migration
  "subAgentViewer",
])

/**
 * Bridge our session store to the DataProvider's expected Data shape.
 */
export const DataBridge: Component<{ children: any }> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const prov = useProvider()
  const server = useServer()

  const data = createMemo(() => {
    const id = session.currentSessionID()
    const family = session.familyData(id)
    return {
      session: session.sessions().map((s) => ({ ...s, id: s.id, role: "user" as const })) as unknown as any[],
      session_status: family.status as unknown as Record<string, any>,
      session_diff: {} as Record<string, any[]>,
      // Restrict chat data to the selected session family (self + subagents).
      // This keeps unrelated tracked sessions from invalidating the visible
      // chat tree during streaming or background updates.
      message: family.messages as Record<string, SDKMessage[]>,
      part: family.parts as Record<string, SDKPart[]>,
      permission: (() => {
        const grouped: Record<string, any[]> = {}
        for (const p of session.permissions()) {
          const sid = p.sessionID
          if (!sid) continue
          ;(grouped[sid] ??= []).push(p)
        }
        return grouped
      })(),
      // Questions are handled directly by QuestionDock via session.questions(),
      // not through DataProvider. The DataProvider's question field is unused here.
      question: {},
      provider: {
        all: Object.values(prov.providers()) as unknown as any[],
        connected: prov.connected(),
        default: prov.defaults(),
      } as unknown as any,
    }
  })

  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) => {
    session.respondToPermission(input.permissionID, input.response, [], [])
  }

  const reply = (input: { requestID: string; answers: string[][] }) => {
    session.replyToQuestion(input.requestID, input.answers)
  }

  const reject = (input: { requestID: string }) => {
    session.rejectQuestion(input.requestID)
  }

  const open = (filePath: string, line?: number, column?: number) => {
    vscode.postMessage({ type: "openFile", filePath, line, column })
  }

  const directory = () => {
    const dir = server.workspaceDirectory()
    if (!dir) return ""
    return dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + "/"
  }

  return (
    <DataProvider
      data={data()}
      directory={directory()}
      // @ts-expect-error — onPermissionRespond/onQuestion* are extension-specific props not yet in kilo-ui's DataProvider types
      onPermissionRespond={respond}
      onQuestionReply={reply}
      onQuestionReject={reject}
      onOpenFile={open}
    >
      {props.children}
    </DataProvider>
  )
}

/**
 * Wraps children in LanguageProvider, passing server-side language info.
 * Must be below ServerProvider in the hierarchy.
 */
export const LanguageBridge: Component<{ children: any }> = (props) => {
  const server = useServer()
  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      {props.children}
    </LanguageProvider>
  )
}

// Inner app component that uses the contexts
const AppContent: Component = () => {
  const [currentView, setCurrentView] = createSignal<ViewType>("newTask")
  const [settingsTab, setSettingsTab] = createSignal<string | undefined>()
  const [migrationReturnView, setMigrationReturnView] = createSignal<ViewType>("newTask") // legacy-migration
  const session = useSession()
  const server = useServer()

  const handleViewAction = (action: string) => {
    switch (action) {
      case "plusButtonClicked":
        window.dispatchEvent(new CustomEvent("newTaskRequest"))
        setCurrentView("newTask")
        break
      case "marketplaceButtonClicked":
        setCurrentView("marketplace")
        break
      case "historyButtonClicked":
        setCurrentView("history")
        break
      case "cloudHistoryButtonClicked":
        setCurrentView("cloudHistory")
        break
      case "profileButtonClicked":
        setCurrentView("profile")
        break
      case "settingsButtonClicked":
        setCurrentView("settings")
        break
      case "cycleAgentMode":
        if (document.hasFocus()) cycleAgent(1)
        break
      case "cyclePreviousAgentMode":
        if (document.hasFocus()) cycleAgent(-1)
        break
    }
  }

  const cycleAgent = (direction: 1 | -1) => {
    const available = session.agents().filter((a) => a.mode !== "subagent" && !a.hidden)
    if (available.length <= 1) return
    const current = session.selectedAgent()
    const idx = available.findIndex((a) => a.name === current)
    const raw = idx + direction
    const next = raw < 0 ? available.length - 1 : raw >= available.length ? 0 : raw
    const agent = available[next]
    if (agent) session.selectAgent(agent.name)
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message?.type === "action" && message.action) {
        console.log("[Kilo New] App: 🎬 action:", message.action)
        handleViewAction(message.action)
      }
      if (message?.type === "navigate" && message.view && VALID_VIEWS.has(message.view)) {
        console.log("[Kilo New] App: 🧭 navigate:", message.view, message.tab ? `tab=${message.tab}` : "")
        if (message.tab) setSettingsTab(message.tab)
        setCurrentView(message.view as ViewType)
      }
      if (message?.type === "openCloudSession" && message.sessionId) {
        console.log("[Kilo New] App: ☁️ openCloudSession:", message.sessionId)
        session.selectCloudSession(message.sessionId)
        setCurrentView("newTask")
      }
      if (message?.type === "viewSubAgentSession" && message.sessionID) {
        console.log("[Kilo New] App: 🔍 viewSubAgentSession:", message.sessionID)
        session.setCurrentSessionID(message.sessionID)
        setCurrentView("subAgentViewer")
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const handleSelectSession = (id: string) => {
    session.selectSession(id)
    setCurrentView("newTask")
  }

  return (
    <div class="container">
      <Switch fallback={<ChatView />}>
        <Match when={currentView() === "newTask"}>
          <ChatView onSelectSession={handleSelectSession} />
        </Match>
        <Match when={currentView() === "marketplace"}>
          <MarketplaceView />
        </Match>
        <Match when={currentView() === "history"}>
          <SessionList onSelectSession={handleSelectSession} onBack={() => setCurrentView("newTask")} />
        </Match>
        <Match when={currentView() === "cloudHistory"}>
          <CloudSessionList
            onBack={() => setCurrentView("newTask")}
            onSelectSession={(cloudSessionId) => {
              session.selectCloudSession(cloudSessionId)
              setCurrentView("newTask")
            }}
          />
        </Match>
        <Match when={currentView() === "profile"}>
          <ProfileView
            profileData={server.profileData()}
            deviceAuth={server.deviceAuth()}
            onLogin={server.startLogin}
          />
        </Match>
        <Match when={currentView() === "settings"}>
          <Settings
            tab={settingsTab()}
            onTabChange={setSettingsTab}
            onMigrateClick={() => {
              setMigrationReturnView("settings")
              setCurrentView("migration")
            }}
          />
          {/* legacy-migration */}
        </Match>
        {/* legacy-migration start */}
        <Match when={currentView() === "migration"}>
          <MigrationWizard
            onBack={() => setCurrentView(migrationReturnView())}
            onComplete={() => setCurrentView(migrationReturnView())}
          />
        </Match>
        {/* legacy-migration end */}
        <Match when={currentView() === "subAgentViewer"}>
          <ChatView readonly />
        </Match>
      </Switch>
    </div>
  )
}

// Main App component with context providers
const App: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <DiffComponentProvider component={Diff}>
                  <CodeComponentProvider component={Code}>
                    <FileComponentProvider component={File}>
                      <ProviderProvider>
                        <ConfigProvider>
                          <NotificationsProvider>
                            <SessionProvider>
                              <DataBridge>
                                <AppContent />
                              </DataBridge>
                            </SessionProvider>
                          </NotificationsProvider>
                        </ConfigProvider>
                      </ProviderProvider>
                    </FileComponentProvider>
                  </CodeComponentProvider>
                </DiffComponentProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}

export default App
