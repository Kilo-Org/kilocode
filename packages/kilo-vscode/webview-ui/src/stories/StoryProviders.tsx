/** @jsxImportSource solid-js */
/**
 * StoryProviders — wraps composite stories with all required contexts.
 *
 * Instead of instantiating the full VSCodeProvider → ServerProvider → SessionProvider
 * chain (which requires a real extension host / SSE connection), we provide mock
 * context values directly.
 */

import { createSignal, type ParentComponent } from "solid-js"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { I18nProvider } from "@kilocode/kilo-ui/context"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { SessionContext } from "../context/session"
import { LanguageContext } from "../context/language"
import { dict as uiEn } from "@kilocode/kilo-ui/i18n/en"
import { dict as appEn } from "../i18n/en"
import { dict as kiloEn } from "@kilocode/kilo-i18n/en"
import type { PermissionRequest, QuestionRequest } from "../types/messages"

// Merged English dictionary (same merge order as the real LanguageProvider)
const dict: Record<string, string> = { ...appEn, ...uiEn, ...kiloEn }

function t(key: string) {
  return dict[key] ?? key
}

// ---------------------------------------------------------------------------
// Default mock data (empty session)
// ---------------------------------------------------------------------------

export const defaultMockData = {
  session: [],
  session_status: {},
  session_diff: {},
  message: {} as Record<string, any[]>,
  part: {} as Record<string, any[]>,
  permission: {} as Record<string, any[]>,
  question: {},
  provider: { all: [], connected: false, default: {} },
}

// ---------------------------------------------------------------------------
// Mock SessionContext value — only the subset used by components
// ---------------------------------------------------------------------------

function noop() {}

export function mockSessionValue(overrides?: {
  id?: string
  permissions?: PermissionRequest[]
  questions?: QuestionRequest[]
  status?: string
}) {
  const id = overrides?.id ?? "story-session-001"
  const permissions = overrides?.permissions ?? []
  const qs = overrides?.questions ?? []
  const status = (overrides?.status ?? "idle") as "idle" | "busy"

  return {
    currentSessionID: () => id,
    currentSession: () => ({
      id,
      title: "Story session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    setCurrentSessionID: noop,
    sessions: () => [],
    status: () => status,
    statusInfo: () => ({ type: status }),
    statusText: () => (status === "idle" ? undefined : "Thinking…"),
    busySince: () => (status === "busy" ? Date.now() - 2000 : undefined),
    loading: () => false,
    messages: () => [],
    userMessages: () => [],
    allMessages: () => ({}),
    allParts: () => ({}),
    allStatusMap: () => ({}),
    getParts: () => [],
    todos: () => [],
    permissions: () => permissions,
    questions: () => qs,
    questionErrors: () => new Set<string>(),
    selected: () => ({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }),
    selectModel: noop,
    totalCost: () => 0,
    contextUsage: () => undefined,
    agents: () => [{ name: "code", description: "Code mode", mode: "primary" as const }],
    selectedAgent: () => "code",
    selectAgent: noop,
    getSessionAgent: () => "code",
    getSessionModel: () => ({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }),
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
}

// ---------------------------------------------------------------------------
// StoryProviders component
// ---------------------------------------------------------------------------

interface StoryProvidersProps {
  data?: any
  permissions?: PermissionRequest[]
  questions?: QuestionRequest[]
  status?: string
  sessionID?: string
  /** When true, renders children without the default 12px padding wrapper */
  noPadding?: boolean
}

export const StoryProviders: ParentComponent<StoryProvidersProps> = (props) => {
  const data = () => props.data ?? defaultMockData
  const session = mockSessionValue({
    id: props.sessionID,
    permissions: props.permissions,
    questions: props.questions,
    status: props.status,
  })
  const [locale] = createSignal<"en">("en")

  return (
    <DialogProvider>
      <LanguageContext.Provider
        value={{
          locale,
          setLocale: noop,
          userOverride: () => "" as any,
          t,
        }}
      >
        <I18nProvider value={{ locale: () => "en", t }}>
          <SessionContext.Provider value={session as any}>
            <DataProvider data={data()} directory="/project/">
              <DiffComponentProvider component={Diff}>
                <CodeComponentProvider component={Code}>
                  <MarkedProvider>
                    {props.noPadding ? props.children : <div style={{ padding: "12px" }}>{props.children}</div>}
                  </MarkedProvider>
                </CodeComponentProvider>
              </DiffComponentProvider>
            </DataProvider>
          </SessionContext.Provider>
        </I18nProvider>
      </LanguageContext.Provider>
    </DialogProvider>
  )
}
