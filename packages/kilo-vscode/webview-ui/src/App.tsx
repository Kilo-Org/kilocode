import { Component, createSignal, createMemo, Switch, Match, Show, onMount, onCleanup } from "solid-js"
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
import HistoryView from "./components/history/HistoryView"
import { MigrationWizard } from "./components/migration" // legacy-migration
import { NotificationsProvider } from "./context/notifications"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import "./styles/chat.css"

type ViewType = "newTask" | "marketplace" | "history" | "profile" | "settings" | "subAgentViewer"
const VALID_VIEWS = new Set<string>(["newTask", "marketplace", "history", "profile", "settings", "subAgentViewer"])

/**
 * Bridge our session store to the DataProvider's expected Data shape.
 *
 * CRITICAL: `data` is a plain object with getters — NOT a createMemo wrapping
 * the whole shape. Wrapping the shape in a memo defeats Solid's fine-grained
 * reactivity: any single `store.parts[X]` mutation would re-run the outer
 * memo, producing a fresh POJO, which invalidates every downstream consumer
 * that reads `data.store.*` — including all mounted SessionTurn memos that
 * scan all messages in the session. With hundreds of messages and a dozen
 * visible turns, per-token streaming ends up doing O(N × visible_turns) work
 * per delta, which is why long sessions stream slowly.
 *
 * By exposing the underlying Solid store directly via getters, consumers
 * reading `data.store.message[X]` or `data.store.part[Y]` subscribe to only
 * that specific key. A text-delta on message Y only invalidates consumers
 * that actually read `part[Y]`, not the whole tree.
 */
export const DataBridge: Component<{ children: any }> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const prov = useProvider()
  const server = useServer()

  // Memos for fields that change infrequently (not per-token) — cheap and
  // avoids allocating a fresh array/object on every consumer read.
  const sessionList = createMemo(
    () => session.sessions().map((s) => ({ ...s, id: s.id, role: "user" as const })) as unknown as any[],
  )

  const permissionsBySession = createMemo(() => {
    const grouped: Record<string, any[]> = {}
    for (const p of session.permissions()) {
      const sid = p.sessionID
      if (!sid) continue
      ;(grouped[sid] ??= []).push(p)
    }
    return grouped
  })

  const providerData = createMemo(() => ({
    all: Object.values(prov.providers()) as unknown as any[],
    connected: prov.connected(),
    default: prov.defaults(),
  }))

  // Stable object with reactive getters — passes through to Solid stores so
  // consumers keep per-key reactivity. The family-filter previously done here
  // was counter-productive: consumers only ever do per-session-id / per-
  // message-id lookups, so they never see unrelated entries in practice, and
  // the filter pass itself was the source of the O(N) cascade.
  const data = {
    get session() {
      return sessionList()
    },
    get session_status() {
      return session.allStatusMap() as unknown as Record<string, any>
    },
    get session_diff() {
      return {} as Record<string, any[]>
    },
    get message() {
      return session.allMessages() as unknown as Record<string, SDKMessage[]>
    },
    get part() {
      return session.allParts() as unknown as Record<string, SDKPart[]>
    },
    get permission() {
      return permissionsBySession()
    },
    // Questions are handled directly by QuestionDock via session.questions(),
    // not through DataProvider. The DataProvider's question field is unused here.
    get question() {
      return {}
    },
    get provider() {
      return providerData() as unknown as any
    },
  }

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

  const openDiff = (diff: { file: string; before: string; after: string; additions: number; deletions: number }) => {
    vscode.postMessage({ type: "openDiffVirtual", diff })
  }

  const openUrl = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  const directory = () => {
    const dir = server.workspaceDirectory()
    if (!dir) return ""
    return dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + "/"
  }

  return (
    <DataProvider
      data={data}
      directory={directory()}
      // @ts-expect-error — onPermissionRespond/onQuestion* are extension-specific props not yet in kilo-ui's DataProvider types
      onPermissionRespond={respond}
      onQuestionReply={reply}
      onQuestionReject={reject}
      onOpenFile={open}
      onOpenDiff={openDiff}
      onOpenUrl={openUrl}
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
  // legacy-migration: state-driven flag independent of currentView to avoid
  // race conditions with SettingsEditorProvider's navigate messages.
  const [migrationNeeded, setMigrationNeeded] = createSignal(false)
  const session = useSession()
  const server = useServer()
  const vscode = useVSCode()

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

  const handleForked = (message: { type?: string; sessionID?: string }) => {
    if (message.type !== "sessionForked" || !message.sessionID) return
    session.selectSession(message.sessionID)
    setCurrentView("newTask")
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
      handleForked(message)
      if (message?.type === "viewSubAgentSession" && message.sessionID) {
        console.log("[Kilo New] App: 🔍 viewSubAgentSession:", message.sessionID)
        session.setCurrentSessionID(message.sessionID)
        setCurrentView("subAgentViewer")
      }
      // legacy-migration: state-driven migration wizard
      if (message?.type === "migrationState") {
        console.log("[Kilo New] App: 🔄 migrationState:", message.needed)
        setMigrationNeeded(message.needed)
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const handleSelectSession = (id: string) => {
    session.selectSession(id)
    setCurrentView("newTask")
  }

  const handleForkMessage = (sessionId: string, messageId: string) => {
    vscode.postMessage({ type: "forkSession", sessionId, messageId })
  }

  return (
    <div class="container">
      {/* legacy-migration start — state-driven overlay, independent of currentView */}
      <Show
        when={migrationNeeded()}
        fallback={
          <Switch
            fallback={
              <ChatView
                continueInWorktree
                onForkMessage={session.status() === "idle" ? handleForkMessage : undefined}
                promptBoxId="sidebar:fallback"
              />
            }
          >
            <Match when={currentView() === "newTask"}>
              <ChatView
                onSelectSession={handleSelectSession}
                onShowHistory={() => setCurrentView("history")}
                onForkMessage={session.status() === "idle" ? handleForkMessage : undefined}
                continueInWorktree
                promptBoxId="sidebar:new-task"
              />
            </Match>
            <Match when={currentView() === "marketplace"}>
              <MarketplaceView />
            </Match>
            <Match when={currentView() === "history"}>
              <HistoryView onSelectSession={handleSelectSession} onBack={() => setCurrentView("newTask")} />
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
                  setMigrationNeeded(true)
                  vscode.postMessage({ type: "requestLegacyMigrationData" })
                }}
              />
            </Match>
            <Match when={currentView() === "subAgentViewer"}>
              <ChatView readonly />
            </Match>
          </Switch>
        }
      >
        <MigrationWizard onBack={() => setMigrationNeeded(false)} onComplete={() => setMigrationNeeded(false)} />
      </Show>
      {/* legacy-migration end */}
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
