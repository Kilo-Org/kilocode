import {
  Component,
  createSignal,
  createMemo,
  createEffect,
  on,
  Switch,
  Match,
  Show,
  onMount,
  onCleanup,
} from "solid-js"
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
import type { Part, TextPart } from "./types/messages"
import { speak, stop as stopSpeech, ensureAudioReady } from "./utils/speech-playback"
import { filterTextForSpeech, detectSentiment } from "./utils/speech-text-filter"
import { SpeechProviderRegistry } from "./data/speech-providers"
import type { SpeechSettings } from "./types/voice"
import type { ExtensionMessage } from "./types/messages"
import "./styles/chat.css"

type ViewType = "newTask" | "marketplace" | "history" | "profile" | "settings" | "subAgentViewer"
const VALID_VIEWS = new Set<string>(["newTask", "marketplace", "history", "profile", "settings", "subAgentViewer"])

function getApiKeyForProvider(ss: SpeechSettings, pid: string): string {
  if (pid === "azure") return ss.azure?.apiKey ?? ""
  if (pid === "google") return ss.google?.apiKey ?? ""
  if (pid === "openai") return ss.openai?.apiKey ?? ""
  if (pid === "elevenlabs") return ss.elevenlabs?.apiKey ?? ""
  if (pid === "polly") return ss.polly?.accessKeyId ?? ""
  return ""
}

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
      data={data()}
      directory={directory()}
      // @ts-expect-error — onPermissionRespond/onQuestion* are extension-specific props not yet in kilo-ui's DataProvider types
      onPermissionRespond={respond}
      onQuestionReply={reply}
      onQuestionReject={reject}
      onOpenFile={open}
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

  // ── Auto-speak: speak last assistant reply when session goes idle ──
  const [speechSettings, setSpeechSettings] = createSignal<SpeechSettings | null>(null)
  let lastSpokenMessageId = ""

  onMount(() => {
    vscode.postMessage({ type: "requestSpeechSettings" })
  })
  const unsubSpeech = vscode.onMessage((msg: ExtensionMessage) => {
    if (msg.type === "speechSettingsLoaded") {
      setSpeechSettings(msg.settings)
    }
  })

  // Fallback: retry speech settings request if no response within 3 seconds
  // (matches the pattern used for agents and MCP status in SessionProvider)
  const speechFallback = setTimeout(() => {
    if (speechSettings() === null) {
      vscode.postMessage({ type: "requestSpeechSettings" })
    }
  }, 3000)

  // Also retry once extension signals it's fully initialized
  const unsubReady = vscode.onMessage((msg: ExtensionMessage) => {
    if (msg.type !== "extensionDataReady") return
    if (speechSettings() === null) {
      vscode.postMessage({ type: "requestSpeechSettings" })
    }
  })

  onCleanup(() => {
    unsubSpeech()
    unsubReady()
    clearTimeout(speechFallback)
  })

  // Watch for busy → idle transition to auto-speak
  // The outer effect tracks session status to detect busy→idle transitions.
  // The inner effect tracks speechSettings and triggers speak when settings are loaded
  // (handles the race where settings arrive after the first idle transition).
  createEffect(
    on(
      () => session.status(),
      (newStatus, prevStatus) => {
        if (prevStatus !== "busy" || newStatus !== "idle") return
        const ss = speechSettings()
        if (!ss) return // settings not loaded yet, inner effect will handle when they load

        // Inner effect: track settings changes and speak when they're loaded
        createEffect(() => {
          const settings = speechSettings()
          if (!settings?.enabled || !settings?.autoSpeak) return

          const provider = SpeechProviderRegistry.get(settings.provider ?? "browser")
          if (!provider) return
          if (provider.requiresApiKey && !getApiKeyForProvider(settings, provider.id)) return

          const id = session.currentSessionID()
          if (!id) return
          const msgs = session.messages()
          if (!msgs.length) return

          const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant")
          if (!lastAssistant || lastAssistant.id === lastSpokenMessageId) return
          lastSpokenMessageId = lastAssistant.id

          const parts: Part[] = session.allParts()[lastAssistant.id] ?? []
          const rawText = parts
            .filter((p): p is TextPart => p.type === "text")
            .map((p) => p.text)
            .join(" ")
            .trim()
          if (!rawText) return

          // 25-rule text filter: strips code, tool artifacts, identifiers, markdown, enforces length cap
          const textContent = filterTextForSpeech(rawText)
          if (!textContent) return

          // Sentiment-based pitch/rate adjustment
          const sentiment = detectSentiment(textContent)

          ensureAudioReady()
          speak(textContent, provider, {
            region: settings.azure?.region,
            apiKey: getApiKeyForProvider(settings, provider.id),
            voiceId: settings.azure.voiceId,
            pitch: settings.tuning.pitch + sentiment.pitchModifier,
            rate: settings.tuning.rate * sentiment.rateModifier,
            volume: settings.tuning.volume ?? undefined,
            style: settings.tuning.style,
            styleDegree: settings.tuning.styleDegree,
            emphasis: settings.tuning.emphasis,
            pronunciations: settings.tuning.pronunciations,
            audioFormat: settings.tuning.audioFormat,
            globalVolume: settings.volume,
          }).catch((err) => console.error("[Speech] Auto-speak failed:", err))
        })
      },
    ),
  )

  // Interrupt speech on typing (keydown in the window)
  const handleInterruptOnType = (e: KeyboardEvent) => {
    const ss = speechSettings()
    if (!ss?.interruptOnType) return
    // Only interrupt on printable characters, not modifier keys alone
    if (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter") {
      stopSpeech()
    }
  }
  window.addEventListener("keydown", handleInterruptOnType)
  onCleanup(() => window.removeEventListener("keydown", handleInterruptOnType))

  // Stop speech on session switch
  createEffect(
    on(
      () => session.currentSessionID(),
      (_newId, prevId) => {
        if (prevId && _newId !== prevId) {
          stopSpeech()
        }
      },
    ),
  )

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
