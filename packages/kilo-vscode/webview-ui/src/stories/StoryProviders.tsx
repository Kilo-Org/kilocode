/** @jsxImportSource solid-js */
/**
 * StoryProviders — wraps composite stories with all required contexts.
 *
 * Instead of instantiating the full VSCodeProvider → ServerProvider → SessionProvider
 * chain (which requires a real extension host / SSE connection), we provide mock
 * context values directly. Where a real provider is safe to instantiate without an
 * extension host (VSCodeProvider, ServerProvider, ProviderProvider), we use the real
 * thing so components that call useVSCode()/useServer()/useProvider()/useIndexing()
 * don't throw.
 */

import { createSignal, createMemo, type ParentComponent } from "solid-js"
import { VSCodeProvider } from "../context/vscode"
import { ServerProvider } from "../context/server"
import { ProviderContext } from "../context/provider"
import { flattenModels, findModel as _findModel } from "../context/provider-utils"
import { ConfigProvider, ConfigContext } from "../context/config"
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
import { NotificationsContext } from "../context/notifications"
import { LanguageContext } from "../context/language"
import { IndexingProvider } from "../context/indexing"
import { dict as uiEn } from "@kilocode/kilo-ui/i18n/en"
import { dict as appEn } from "../i18n/en"
import { dict as amEn } from "../../agent-manager/i18n/en"
import { dict as kiloEn } from "@kilocode/kilo-i18n/en"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { resolveTemplate } from "../context/language-utils"
import type {
  Config,
  KilocodeNotification,
  PermissionRequest,
  QuestionRequest,
  SuggestionRequest,
} from "../types/messages"

type PluginSpec = string | [string, Record<string, unknown>]

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
        limit: { context: 200000, output: 8192 },
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
    models: () => MOCK_MODELS,
    findModel: (sel: any) => _findModel(MOCK_MODELS, sel),
    authMethods: () => ({}),
    authStates: () => ({}),
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
// Mock NotificationsContext value
// ---------------------------------------------------------------------------

function noop() {}

function mockNotificationsValue(items: KilocodeNotification[] = []) {
  return {
    notifications: () => items,
    filteredNotifications: () => items,
    dismiss: noop,
  }
}

// ---------------------------------------------------------------------------
// Mock SessionContext value — only the subset used by components
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function merge(target: Record<string, unknown>, source: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const prev = result[key]
    if (isRecord(value) && isRecord(prev)) {
      result[key] = merge(prev, value)
      continue
    }
    result[key] = value
  }
  return result
}

export function mockSessionValue(overrides?: {
  id?: string
  permissions?: PermissionRequest[]
  questions?: QuestionRequest[]
  suggestions?: SuggestionRequest[]
  status?: string
}) {
  const id = overrides?.id ?? "story-session-001"
  const permissions = overrides?.permissions ?? []
  const qs = overrides?.questions ?? []
  const suggestions = overrides?.suggestions ?? []
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
    loadingOlderMessages: () => false,
    hasOlderMessages: () => false,
    messageMutation: () => undefined,
    messages: () => [],
    userMessages: () => [],
    allMessages: () => ({}),
    allParts: () => ({}),
    allStatusMap: () => ({}),
    getParts: () => [],
    hydrateParts: noop,
    todos: () => [],
    permissions: () => permissions,
    respondingPermissions: () => new Set<string>(),
    questions: () => qs,
    questionErrors: () => new Set<string>(),
    suggestions: () => suggestions,
    suggestionErrors: () => new Set<string>(),
    respondingSuggestions: () => new Set<string>(),
    scopedPermissions: (sid?: string) => (sid ? permissions.filter((p) => p.sessionID === sid) : permissions),
    scopedQuestions: (sid?: string) => (sid ? qs.filter((q) => q.sessionID === sid) : qs),
    scopedSuggestions: (sid?: string) => (sid ? suggestions.filter((item) => item.sessionID === sid) : suggestions),
    selected: () => ({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4-6" }),
    selectModel: noop,
    hasModelOverride: () => false,
    clearModelOverride: noop,
    costBreakdown: () => [],
    contextUsage: () => undefined,
    agents: () => [{ name: "code", description: "Code mode", mode: "primary" as const }],
    allAgents: () => [{ name: "code", description: "Code mode", mode: "primary" as const }],
    skills: () => [],
    refreshSkills: noop,
    removeSkill: noop,
    removeMode: noop,
    selectedAgent: () => "code",
    selectAgent: noop,
    getSessionAgent: () => "code",
    getSessionModel: () => ({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4-6" }),
    setSessionModel: noop,
    setSessionAgent: noop,
    revert: () => undefined,
    revertedCount: () => 0,
    summary: () => undefined,
    worktreeStats: () => undefined,
    revertSession: noop,
    unrevertSession: noop,
    favoriteModels: () => [],
    toggleFavorite: noop,
    variantList: () => [],
    currentVariant: () => undefined,
    selectVariant: noop,
    sendMessage: noop,
    sendCommand: noop,
    abort: noop,
    compact: noop,
    respondToPermission: noop,
    replyToQuestion: noop,
    rejectQuestion: noop,
    acceptSuggestion: noop,
    dismissSuggestion: noop,
    createSession: noop,
    clearCurrentSession: noop,
    loadSessions: noop,
    loadOlderMessages: noop,
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
  suggestions?: SuggestionRequest[]
  notifications?: KilocodeNotification[]
  status?: string
  sessionID?: string
  /** When provided, injects a mock ConfigContext with this config instead of the real ConfigProvider. */
  config?: Config
  onConfigChange?: (config: Config) => void
  /** When true, renders children without the default 12px padding wrapper */
  noPadding?: boolean
}

/** Wraps children with either a mock ConfigContext (when config prop is given) or the real ConfigProvider. */
const ConfigWrapper: ParentComponent<{ config?: Config; onConfigChange?: (config: Config) => void }> = (props) => {
  if (props.config) {
    const [cfg, setCfg] = createSignal(props.config)
    const features = createMemo(() => {
      const config = cfg() as Config & {
        plugin?: readonly PluginSpec[] | null
      }

      return {
        indexing: hasIndexingPlugin(config.plugin ?? []) && config.experimental?.semantic_indexing === true,
      }
    })

    const value = {
      config: createMemo(() => cfg()),
      features,
      loading: () => false,
      isDirty: () => false,
      saving: () => false,
      saveError: () => null,
      updateConfig: (partial: Partial<Config>) => {
        setCfg((prev) => {
          const next = merge(prev as Record<string, unknown>, partial as Record<string, unknown>) as Config
          props.onConfigChange?.(next)
          return next
        })
      },
      saveConfig: noop,
      discardConfig: noop,
    }
    return <ConfigContext.Provider value={value}>{props.children}</ConfigContext.Provider>
  }
  return <ConfigProvider>{props.children}</ConfigProvider>
}

export const StoryProviders: ParentComponent<StoryProvidersProps> = (props) => {
  const data = () => props.data ?? defaultMockData
  const session = mockSessionValue({
    id: props.sessionID,
    permissions: props.permissions,
    questions: props.questions,
    suggestions: props.suggestions,
    status: props.status,
  })
  const notifications = mockNotificationsValue(props.notifications)
  const [locale] = createSignal<"en">("en")

  return (
    <VSCodeProvider>
      <ServerProvider>
        <ConfigWrapper config={props.config} onConfigChange={props.onConfigChange}>
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
                  <NotificationsContext.Provider value={notifications}>
                    <SessionContext.Provider value={session as any}>
                      <IndexingProvider>
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
                      </IndexingProvider>
                    </SessionContext.Provider>
                  </NotificationsContext.Provider>
                </I18nProvider>
              </LanguageContext.Provider>
            </DialogProvider>
          </MockProviderProvider>
        </ConfigWrapper>
      </ServerProvider>
    </VSCodeProvider>
  )
}
