import {
  Component,
  type ParentComponent,
  type ComponentProps,
  createSignal,
  createMemo,
  createEffect,
  Switch,
  Match,
  Show,
  onMount,
  onCleanup,
} from "solid-js"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import ProfileView from "./components/profile/ProfileView"
import { useVSCode } from "./context/vscode"
import { useServer } from "./context/server"
import { useProvider } from "./context/provider"
import { useSession, useSessionVisibility } from "./context/session"
import { LocalTabsProvider, useLocalTabs } from "./context/local-tabs"
import { ProviderShell } from "./context/provider-shell"
import { ChatView } from "./components/chat"
import { SidebarEmptyState } from "./components/chat/SidebarEmptyState"
import { SidebarTopBar } from "./components/chat/SidebarTopBar"
import { registerExpandedTaskTool } from "./components/chat/TaskToolExpanded"
import { registerVscodeToolOverrides } from "./components/chat/VscodeToolOverrides"
import { strongest } from "./utils/session-activity"
import { adjacentTab } from "./utils/local-tabs"
import { focusPrompt } from "./utils/tab-navigation"
import { createPlanOpener } from "./utils/open-plan"

// Override the upstream "task" tool renderer with the fully-expanded version
// that shows child session parts inline in the VS Code sidebar.
registerExpandedTaskTool()
// Apply VS Code sidebar preferences to other tools (e.g. bash expanded by default).
registerVscodeToolOverrides()
import HistoryView from "./components/history/HistoryView"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk-v1/v2"
import { cycleAgent as cycle } from "./context/session-agent"
import { routeChatInput } from "./utils/chat-input-route"
import "./styles/chat.css"

type ViewType = "newTask" | "history" | "profile"
const VALID_VIEWS = new Set<string>(["newTask", "history", "profile"])

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
export const DataBridge: ParentComponent = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const prov = useProvider()
  const server = useServer()
  type Data = ComponentProps<typeof DataProvider>["data"]

  // Memos for fields that change infrequently (not per-token) — cheap and
  // avoids allocating a fresh array/object on every consumer read.
  const sessionList = createMemo(
    () => session.sessions().map((s) => ({ ...s, id: s.id, role: "user" as const })) as unknown as Data["session"],
  )

  const permissionsBySession = createMemo(() => {
    const grouped: Record<string, ReturnType<typeof session.permissions>> = {}
    for (const p of session.permissions()) {
      const sid = p.sessionID
      if (!sid) continue
      ;(grouped[sid] ??= []).push(p)
    }
    return grouped
  })

  const providerData = createMemo(() => ({
    all: new Map(Object.entries(prov.providers())),
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
      return session.allStatusMap() as unknown as Data["session_status"]
    },
    get session_diff() {
      return {}
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
      return providerData() as unknown as Data["provider"]
    },
  }

  const open = (filePath: string, line?: number, column?: number, sessionID?: string) => {
    const event = new CustomEvent("kilo:open-file", {
      cancelable: true,
      detail: { filePath, line, column, sessionID },
    })
    if (!window.dispatchEvent(event)) return
    vscode.postMessage({ type: "openFile", filePath, line, column, sessionID })
  }

  const opener = createPlanOpener(session.currentSessionID, (plan) =>
    open(plan.path, undefined, undefined, plan.sessionID),
  )
  const unsubscribePlans = vscode.onMessage(opener.accept)
  createEffect(() => opener.flush(session.currentSessionID()))
  onCleanup(unsubscribePlans)

  const openUrl = (url: string) => {
    vscode.postMessage({ type: "openWebLink", url })
  }

  const openContent = (content: string, language?: string) => {
    vscode.postMessage({ type: "openContent", content, language })
  }

  // File existence validation for code span candidates
  const pending = new Map<string, (existing: string[]) => void>()
  const counter = { n: 0 }
  const validateFiles = (sessionID: string, paths: string[]): Promise<string[]> => {
    const id = `vf-${++counter.n}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          // A timeout is not the same as "checked and none exist" — reject so
          // callers don't cache a false negative for real files on a slow
          // filesystem (see file-link-validator.ts).
          reject(new Error("validateFiles timed out"))
        }
      }, 3000)
      pending.set(id, (existing) => {
        clearTimeout(timer)
        resolve(existing)
      })
      vscode.postMessage({ type: "validateFiles", id, sessionID, paths })
    })
  }
  const handler = (event: MessageEvent) => {
    const msg = event.data
    if (msg?.type === "validateFilesResult" && msg.id) {
      const cb = pending.get(msg.id)
      if (cb) {
        pending.delete(msg.id)
        cb(msg.existing ?? [])
      }
    }
  }
  onMount(() => window.addEventListener("message", handler))
  onCleanup(() => window.removeEventListener("message", handler))

  const directory = () => {
    const dir = server.workspaceDirectory()
    if (!dir) return ""
    return dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + "/"
  }

  return (
    <DataProvider
      data={data}
      directory={directory()}
      onOpenFile={open}
      onOpenUrl={openUrl}
      onOpenContent={openContent}
      onValidateFiles={validateFiles}
      onNavigateToSession={(id) => session.selectSession(id)}
    >
      {props.children}
    </DataProvider>
  )
}

// Inner app component that uses the contexts
const AppContent: Component = () => {
  const [currentView, setCurrentView] = createSignal<ViewType>("newTask")
  const session = useSession()
  const tabs = useLocalTabs()
  const server = useServer()
  const vscode = useVSCode()
  const activity = createMemo(() =>
    strongest([session.currentSessionID(), ...(tabs?.ids() ?? [])].map(session.activityFor)),
  )
  createEffect(() => vscode.postMessage({ type: "sessionActivity", state: activity() }))
  useSessionVisibility(() => (currentView() === "newTask" ? session.currentSessionID() : undefined))

  const newTask = () => {
    if (currentView() === "newTask") {
      window.dispatchEvent(new CustomEvent("newTaskRequest"))
      return
    }
    tabs?.add()
    if (!tabs) session.clearCurrentSession()
    setCurrentView("newTask")
  }

  const handleViewAction = (action: string) => {
    switch (action) {
      case "plusButtonClicked":
        newTask()
        break
      case "closeTask": {
        if (currentView() !== "newTask") break
        const id = tabs?.active()
        if (!tabs || !id) break
        tabs.close(id)
        break
      }
      case "closeAllTasks":
        tabs?.closeAll()
        setCurrentView("newTask")
        break
      case "historyButtonClicked":
        setCurrentView("history")
        break
      case "profileButtonClicked":
        setCurrentView("profile")
        break
      case "cycleAgentMode":
        if (document.hasFocus()) cycleAgent(1)
        break
      case "cyclePreviousAgentMode":
        if (document.hasFocus()) cycleAgent(-1)
        break
      case "tabPrevious":
        step(-1)
        break
      case "tabNext":
        step(1)
        break
      case "focusSearch":
        setCurrentView("newTask")
        window.dispatchEvent(new CustomEvent("focusTranscriptSearch"))
        break
    }
  }

  // Select the session tab next to the active one, like Agent Manager tab navigation.
  // The host sends the action to the sidebar and the active editor tab, so only the focused one acts.
  const step = (offset: -1 | 1) => {
    if (!tabs || !document.hasFocus() || currentView() !== "newTask") return
    const id = adjacentTab(tabs.display(), tabs.active(), offset)
    if (!id) return
    tabs.select(id)
    requestAnimationFrame(focusPrompt)
  }

  const cycleAgent = (direction: 1 | -1) => {
    const id = session.currentSessionID() ?? tabs?.pending() ?? session.draftSessionID()
    cycle({
      agents: session.agents(),
      scope: id,
      direction,
      selected: session.selectedAgent,
      select: session.selectAgent,
    })
  }

  const handleForked = (message: { type?: string; sessionID?: string; forkedFromID?: string }) => {
    if (message.type !== "sessionForked" || !message.sessionID) return
    if (tabs && message.forkedFromID) tabs.openAfter(message.forkedFromID, message.sessionID)
    if (tabs && !message.forkedFromID) tabs.open(message.sessionID)
    if (!tabs) session.selectSession(message.sessionID)
    setCurrentView("newTask")
  }

  const handleKiloModel = (message: { type?: string }) => {
    if (message.type === "selectKiloModel") setCurrentView("newTask")
  }

  const open = (message: { type?: string; sessionID?: string }) => {
    if (message.type !== "openSession" || !message.sessionID) return
    console.log("[Kilo New] App: opening local session:", message.sessionID)
    if (tabs) tabs.open(message.sessionID, { scrollToBottom: true })
    if (!tabs) session.selectSession(message.sessionID, { scrollToBottom: true })
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
        setCurrentView(message.view as ViewType)
      }
      open(message)
      handleKiloModel(message)
      handleForked(message)
      routeChatInput(
        message,
        currentView(),
        () => setCurrentView("newTask"),
        (msg) => window.postMessage(msg, window.origin),
      )
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const handleSelectSession = (id: string) => {
    if (tabs) tabs.open(id)
    if (!tabs) session.selectSession(id)
    setCurrentView("newTask")
  }

  const handleForkMessage = (sessionId: string, messageId: string) => {
    vscode.postMessage({ type: "forkSession", sessionId, messageId })
  }

  const emptyState = () => (
    <SidebarEmptyState onSelectSession={handleSelectSession} onShowHistory={() => setCurrentView("history")} />
  )

  // Set synchronously in the webview HTML by KiloProvider so it's available
  // before this component ever mounts (see buildWebviewHtml/_getHtmlForWebview).
  // False for dedicated single-purpose panels (Settings, Profile, Sub-Agent
  // Viewer) always, and for the Sidebar/"Open in Tab" outside Cursor — real
  // VS Code's native title bar toolbar already covers those. Defaults to
  // true only when unset entirely (e.g. Storybook, which doesn't render the
  // real page HTML).
  const host = window as {
    KILO_TOP_BAR?: boolean
  }
  const showTopBar = host.KILO_TOP_BAR !== false

  return (
    <div class="container">
      <Show when={showTopBar}>
        <SidebarTopBar
          onNewTask={() => handleViewAction("plusButtonClicked")}
          onHistory={() => handleViewAction("historyButtonClicked")}
        />
      </Show>
      <Switch
        fallback={
          <ChatView
            onForkMessage={session.status() === "idle" ? handleForkMessage : undefined}
            promptBoxId="sidebar:fallback"
            emptyState={emptyState}
          />
        }
      >
        <Match when={currentView() === "newTask"}>
          <ChatView
            onSelectSession={handleSelectSession}
            onShowHistory={() => setCurrentView("history")}
            onForkMessage={session.status() === "idle" ? handleForkMessage : undefined}
            promptBoxId="sidebar:new-task"
            emptyState={emptyState}
          />
        </Match>
        <Match when={currentView() === "history"}>
          <HistoryView onSelectSession={handleSelectSession} onBack={() => setCurrentView("newTask")} />
        </Match>
        <Match when={currentView() === "profile"}>
          <ProfileView profileData={server.profileData()} />
        </Match>
      </Switch>
    </div>
  )
}

const App: Component = () => {
  return (
    <ProviderShell.Root>
      <ProviderShell.Session>
        <LocalTabsProvider>
          <DataBridge>
            <AppContent />
          </DataBridge>
        </LocalTabsProvider>
      </ProviderShell.Session>
    </ProviderShell.Root>
  )
}

export default App
