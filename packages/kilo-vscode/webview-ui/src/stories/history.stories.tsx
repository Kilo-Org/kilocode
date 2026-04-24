/** @jsxImportSource solid-js */
/**
 * Stories for the SessionList component (history panel).
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, type ParentComponent } from "solid-js"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { I18nProvider } from "@kilocode/kilo-ui/context"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { File } from "@kilocode/kilo-ui/file"
import { VSCodeProvider } from "../context/vscode"
import { ServerProvider } from "../context/server"
import { ConfigProvider } from "../context/config"
import { ProviderProvider } from "../context/provider"
import { SessionContext } from "../context/session"
import { LanguageContext } from "../context/language"
import { dict as uiEn } from "@kilocode/kilo-ui/i18n/en"
import { dict as appEn } from "../i18n/en"
import { dict as kiloEn } from "@kilocode/kilo-i18n/en"
import SessionList from "../components/history/SessionList"

const dict: Record<string, string> = { ...appEn, ...uiEn, ...kiloEn }
function t(key: string) {
  return dict[key] ?? key
}
function noop() {}

const now = new Date().toISOString()
const yesterday = new Date(Date.now() - 86400000).toISOString()
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

const mockSessions = [
  { id: "s1", title: "Refactor authentication module", createdAt: now, updatedAt: now },
  { id: "s2", title: "Add screenshot test coverage", createdAt: yesterday, updatedAt: yesterday },
  { id: "s3", title: "Fix TypeScript errors in webview", createdAt: weekAgo, updatedAt: weekAgo },
  { id: "s4", title: undefined, createdAt: weekAgo, updatedAt: weekAgo },
]

const WithSessions: ParentComponent<{ sessions?: typeof mockSessions }> = (props) => {
  const [locale] = createSignal<"en">("en")
  const sessions = props.sessions ?? []
  const session = {
    currentSessionID: () => "s1",
    currentSession: () => sessions[0],
    setCurrentSessionID: noop,
    sessions: () => sessions as any,
    status: () => "idle" as const,
    statusInfo: () => ({ type: "idle" }),
    statusText: () => undefined,
    busySince: () => undefined,
    loading: () => false,
    messages: () => [],
    userMessages: () => [],
    allMessages: () => ({}),
    allParts: () => ({}),
    allStatusMap: () => ({}),
    getParts: () => [],
    todos: () => [],
    permissions: () => [],
    questions: () => [],
    questionErrors: () => new Set<string>(),
    scopedPermissions: () => [] as any[],
    scopedQuestions: () => [] as any[],
    selected: () => ({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4-6" }),
    selectModel: noop,
    hasModelOverride: () => false,
    clearModelOverride: noop,
    costBreakdown: () => [],
    contextUsage: () => undefined,
    agents: () => [{ name: "code", description: "Code mode", mode: "primary" as const }],
    selectedAgent: () => "code",
    selectAgent: noop,
    getSessionAgent: () => "code",
    getSessionModel: () => ({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4-6" }),
    setSessionModel: noop,
    setSessionAgent: noop,
    variantList: () => [],
    currentVariant: () => undefined,
    selectVariant: noop,
    sendMessage: noop,
    abort: noop,
    compact: noop,
    respondToPermission: noop,
    replyToQuestion: noop,
    rejectQuestion: noop,
    createSession: noop,
    clearCurrentSession: noop,
    loadSessions: noop,
    selectSession: noop,
    deleteSession: noop,
    renameSession: noop,
    syncSession: noop,
    cloudPreviewId: () => null,
    selectCloudSession: noop,
  }

  return (
    <VSCodeProvider>
      <ServerProvider>
        <ConfigProvider>
          <ProviderProvider>
            <DialogProvider>
              <LanguageContext.Provider value={{ locale, setLocale: noop, userOverride: () => "" as any, t }}>
                <I18nProvider value={{ locale: () => "en", t }}>
                  <SessionContext.Provider value={session as any}>
                    <DataProvider
                      data={{
                        session: sessions as any,
                        session_status: {},
                        session_diff: {},
                        message: {},
                        part: {},
                        provider: { all: [], connected: [] as string[], default: {} as any },
                      }}
                      directory="/project/"
                    >
                      <DiffComponentProvider component={Diff}>
                        <CodeComponentProvider component={Code}>
                          <FileComponentProvider component={File}>
                            <MarkedProvider>
                              <div style={{ padding: "12px" }}>{props.children}</div>
                            </MarkedProvider>
                          </FileComponentProvider>
                        </CodeComponentProvider>
                      </DiffComponentProvider>
                    </DataProvider>
                  </SessionContext.Provider>
                </I18nProvider>
              </LanguageContext.Provider>
            </DialogProvider>
          </ProviderProvider>
        </ConfigProvider>
      </ServerProvider>
    </VSCodeProvider>
  )
}

const meta: Meta = {
  title: "History/SessionList",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

export const WithItems: Story = {
  name: "With sessions",
  render: () => (
    <WithSessions sessions={mockSessions as any}>
      <div style={{ height: "500px" }}>
        <SessionList onSelectSession={noop} />
      </div>
    </WithSessions>
  ),
}
