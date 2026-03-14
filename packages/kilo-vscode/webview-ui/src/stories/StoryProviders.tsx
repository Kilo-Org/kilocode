/** @jsxImportSource solid-js */
/**
 * StoryProviders — wraps composite stories with all required contexts.
 *
 * Instead of instantiating the full VSCodeProvider → ServerProvider → SessionProvider
 * chain (which requires a real extension host / SSE connection), we provide mock
 * context values directly. Where a real provider is safe to instantiate without an
 * extension host (VSCodeProvider, ServerProvider, ProviderProvider), we use the real
 * thing so components that call useVSCode()/useServer()/useProvider() don't throw.
 */

import { createSignal, type ParentComponent } from "solid-js"
import { VSCodeProvider } from "../context/vscode"
import { ServerProvider } from "../context/server"
import { ProviderContext } from "../context/provider"
import { flattenModels, findModel as _findModel } from "../context/provider-utils"
import { ConfigProvider } from "../context/config"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { I18nProvider } from "@kilocode/kilo-ui/context"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { File } from "@kilocode/kilo-ui/file"
import { SessionContext } from "../context/session"
import { LanguageContext } from "../context/language"
import { dict as uiEn } from "@kilocode/kilo-ui/i18n/en"
import { dict as appEn } from "../i18n/en"
import { dict as amEn } from "../../agent-manager/i18n/en"
import { dict as kiloEn } from "@kilocode/kilo-i18n/en"
import { resolveTemplate } from "../context/language-utils"
import type { PermissionRequest, QuestionRequest } from "../types/messages"

// Merged English dictionary (same merge order as the real LanguageProvider)
const dict: Record<string, string> = { ...appEn, ...amEn, ...uiEn, ...kiloEn }

function t(key: string, params?: Record<string, string | number | boolean | undefined>) {
  return resolveTemplate(dict[key] ?? key, params)
}

// ---------------------------------------------------------------------------
// Default mock data (empty session)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock providers — pre-loaded Kilo Gateway model for stories
// ---------------------------------------------------------------------------

const MOCK_PROVIDERS = {
  kilo: {
    id: "kilo",
    name: "Kilo",
    env: [] as string[],
    models: {
      "anthropic/claude-sonnet-4-6": {
        id: "anthropic/claude-sonnet-4-6",
        name: "Anthropic: Claude Sonnet 4.6",
        inputPrice: 0.003,
        outputPrice: 0.015,
      },
    },
  },
}

const MOCK_MODELS = flattenModels(MOCK_PROVIDERS as any)

/** A synchronous mock ProviderContext — provides models without waiting for a postMessage round-trip. */
const MockProviderProvider: ParentComponent = (props) => {
  const value = {
    providers: () => MOCK_PROVIDERS as any,
    connected: () => ["kilo"],
    defaults: () => ({}),
    defaultSelection: () => ({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4-6" }),
    authMethods: () => ({}),
    authStates: () => ({}),
    models: () => MOCK_MODELS,
    findModel: (sel: any) => _findModel(MOCK_MODELS, sel),
    isModelValid: () => true,
  }
  return <ProviderContext.Provider value={value}>{props.children}</ProviderContext.Provider>
}

/** @deprecated use MockProviderProvider; kept for callers that still call dispatchMockProviders */
function dispatchMockProviders() {}

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
    respondingPermissions: () => new Set<string>(),
    questions: () => qs,
    questionErrors: () => new Set<string>(),
    scopedPermissions: (sid?: string) => (sid ? permissions.filter((p) => p.sessionID === sid) : permissions),
    scopedQuestions: (sid?: string) => (sid ? qs.filter((q) => q.sessionID === sid) : qs),
    selected: () => ({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4-6" }),
    selectModel: noop,
    hasModelOverride: () => false,
    clearModelOverride: noop,
    totalCost: () => 0,
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
    <VSCodeProvider>
      <ServerProvider>
        <ConfigProvider>
          <MockProviderProvider>
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
                          <FileComponentProvider component={File}>
                            <MarkedProvider>
                              {props.noPadding ? (
                                props.children
                              ) : (
                                <div style={{ padding: "12px" }}>{props.children}</div>
                              )}
                            </MarkedProvider>
                          </FileComponentProvider>
                        </CodeComponentProvider>
                      </DiffComponentProvider>
                    </DataProvider>
                  </SessionContext.Provider>
                </I18nProvider>
              </LanguageContext.Provider>
            </DialogProvider>
          </MockProviderProvider>
        </ConfigProvider>
      </ServerProvider>
    </VSCodeProvider>
  )
}
