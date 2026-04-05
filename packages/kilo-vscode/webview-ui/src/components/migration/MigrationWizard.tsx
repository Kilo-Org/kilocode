/**
 * legacy-migration - Multi-step migration wizard UI component.
 *
 * Screens:
 *   1. What's New  — feature showcase for the new extension
 *   2. Migrate     — grouped selection, live in-place progress, cleanup
 */

import { Show, createSignal, onMount, onCleanup } from "solid-js"
import type { Component, JSX } from "solid-js"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import SessionMigrationProgress, { type SessionMigrationProgressState } from "./SessionMigrationProgress"
import SessionMigrationSummary from "./SessionMigrationSummary"
import ForceReimportDialog from "./ForceReimportDialog"
import RunningMigrationDialog from "./RunningMigrationDialog"
import {
  createSessionItem,
  createSessionSummary,
  updateSessionSummary,
  type SessionSummaryState,
} from "./session-migration-summary-state"
import type {
  MigrationProviderInfo,
  MigrationMcpServerInfo,
  MigrationCustomModeInfo,
  MigrationSessionInfo,
  MigrationResultItem,
  MigrationAutoApprovalSelections,
  LegacySettings,
  LegacyMigrationDataMessage,
  LegacyMigrationProgressMessage,
  LegacyMigrationSessionProgressMessage,
  LegacyMigrationCompleteMessage,
} from "../../types/messages"
import "./migration.css"

// ---------------------------------------------------------------------------
// KiloLogo — replicates the pattern from MessageList.tsx
// ---------------------------------------------------------------------------

const KiloLogo = (): JSX.Element => {
  const iconsBaseUri = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const isLight =
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
  const icon = isLight ? "kilo-light.svg" : "kilo-dark.svg"
  return (
    <div class="migration-wizard__logo">
      <img src={`${iconsBaseUri}/${icon}`} alt="Kilo Code" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline SVG icons for feature cards
// ---------------------------------------------------------------------------

const BoltIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)

const MonitorIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
)

const UsersIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const ServerIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="2" y="12" width="20" height="8" rx="2" />
    <path d="M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
    <line x1="12" y1="16" x2="12" y2="16.01" />
  </svg>
)

const CheckmarkSvg = (): JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="2.5 6 5 8.5 9.5 3.5" />
  </svg>
)

const SuccessCheckSvg = (): JSX.Element => (
  <svg
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="2.5 6 5 8.5 9.5 3.5" />
  </svg>
)

const ErrorXSvg = (): JSX.Element => (
  <svg
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
  </svg>
)

const WarningSvg = (): JSX.Element => (
  <svg
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line x1="6" y1="4" x2="6" y2="7" />
    <line x1="6" y1="9" x2="6" y2="9.01" />
  </svg>
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Screen = "whats-new" | "migrate"
type MigratePhase = "selecting" | "migrating" | "error" | "done"

interface ProgressEntry {
  item: string
  group: string
  status: "pending" | "migrating" | "success" | "warning" | "error"
  message?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MigrationWizardProps {
  onBack: () => void
  onComplete: () => void
}

const MigrationWizard: Component<MigrationWizardProps> = (props) => {
  const vscode = useVSCode()
  const dialog = useDialog()
  const language = useLanguage()

  const [screen, setScreen] = createSignal<Screen>("whats-new")
  const [phase, setPhase] = createSignal<MigratePhase>("selecting")

  // Data from extension
  const [providers, setProviders] = createSignal<MigrationProviderInfo[]>([])
  const [mcpServers, setMcpServers] = createSignal<MigrationMcpServerInfo[]>([])
  const [customModes, setCustomModes] = createSignal<MigrationCustomModeInfo[]>([])
  const [sessions, setSessions] = createSignal<MigrationSessionInfo[]>([])
  const [defaultModel, setDefaultModel] = createSignal<{ provider: string; model: string } | undefined>(undefined)
  const [legacySettings, setLegacySettings] = createSignal<LegacySettings | undefined>(undefined)

  // Group-level selections
  const [migrateProviders, setMigrateProviders] = createSignal(true)
  const [migrateMcpServers, setMigrateMcpServers] = createSignal(true)
  const [migrateModes, setMigrateModes] = createSignal(true)
  const [migrateSessions, setMigrateSessions] = createSignal(true)
  const [migrateDefaultModel, setMigrateDefaultModel] = createSignal(true)
  const [migrateAutoApproval, setMigrateAutoApproval] = createSignal(true)
  const [migrateLanguage, setMigrateLanguage] = createSignal(true)
  const [migrateAutocomplete, setMigrateAutocomplete] = createSignal(true)

  // Progress tracking
  const [progressEntries, setProgressEntries] = createSignal<ProgressEntry[]>([])
  const [results, setResults] = createSignal<MigrationResultItem[]>([])
  const [sessionProgress, setSessionProgress] = createSignal<SessionMigrationProgressState | undefined>(undefined)
  const [sessionSummary, setSessionSummary] = createSignal<SessionSummaryState>(createSessionSummary())
  const [running, setRunning] = createSignal(false)

  // Cleanup preference
  const [clearLegacyData, setClearLegacyData] = createSignal(false)

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.type === "legacyMigrationData") {
        const data = (msg as LegacyMigrationDataMessage).data
        setProviders(data.providers)
        setMcpServers(data.mcpServers)
        setCustomModes(data.customModes)
        setSessions(data.sessions ?? [])
        setDefaultModel(data.defaultModel)
        setLegacySettings(data.settings)

        // Pre-select groups that have data
        setMigrateProviders(data.providers.some((p) => p.supported && p.hasApiKey))
        setMigrateMcpServers(data.mcpServers.length > 0)
        setMigrateModes(data.customModes.length > 0)
        setMigrateSessions((data.sessions?.length ?? 0) > 0)
        setMigrateDefaultModel(Boolean(data.defaultModel))

        const s = data.settings
        if (s) {
          setMigrateAutoApproval(
            s.autoApprovalEnabled !== undefined ||
              Boolean(s.allowedCommands?.length) ||
              Boolean(s.deniedCommands?.length) ||
              s.alwaysAllowReadOnly !== undefined ||
              s.alwaysAllowReadOnlyOutsideWorkspace !== undefined ||
              s.alwaysAllowWrite !== undefined ||
              s.alwaysAllowExecute !== undefined ||
              s.alwaysAllowMcp !== undefined ||
              s.alwaysAllowModeSwitch !== undefined ||
              s.alwaysAllowSubtasks !== undefined,
          )
          setMigrateLanguage(Boolean(s.language))
          setMigrateAutocomplete(Boolean(s.autocomplete))
        }
      }

      if (msg?.type === "legacyMigrationProgress") {
        const update = msg as LegacyMigrationProgressMessage
        setProgressEntries((prev) => {
          const existing = prev.findIndex((e) => e.item === update.item)
          const entry: ProgressEntry = {
            item: update.item,
            group: existing >= 0 ? prev[existing]?.group || update.item : update.item,
            status: update.status,
            message: update.message,
          }
          return existing >= 0 ? prev.map((e, i) => (i === existing ? entry : e)) : [...prev, entry]
        })
      }

      if (msg?.type === "legacyMigrationSessionProgress") {
        const update = msg as LegacyMigrationSessionProgressMessage
        setSessionSummary((prev) =>
          updateSessionSummary(prev, createSessionItem(update.session, update.error), update.phase),
        )
        setSessionProgress({
          session: update.session,
          index: update.index,
          total: update.total,
          phase: update.phase,
          error: update.error,
        })
      }

      if (msg?.type === "legacyMigrationComplete") {
        const complete = msg as LegacyMigrationCompleteMessage
        setResults(complete.results)
        setRunning(false)
        const hasErrors = complete.results.some((r) => r.status === "error")
        setPhase(hasErrors ? "error" : "done")
        if (!hasErrors) {
          vscode.postMessage({ type: "loadSessions" })
        }
      }
    }

    window.addEventListener("message", handler)
    vscode.postMessage({ type: "requestLegacyMigrationData" })
    onCleanup(() => window.removeEventListener("message", handler))
  })

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleSkip = () => {
    vscode.postMessage({ type: "skipLegacyMigration" })
    props.onBack()
  }

  const handleStartMigration = () => {
    const selectedProviderNames = migrateProviders()
      ? providers()
          .filter((p) => p.supported && p.hasApiKey)
          .map((p) => p.profileName)
      : []
    const selectedMcpNames = migrateMcpServers() ? mcpServers().map((s) => s.name) : []
    const selectedModesSlugs = migrateModes() ? customModes().map((m) => m.slug) : []

    const autoApproval: MigrationAutoApprovalSelections = migrateAutoApproval()
      ? {
          commandRules:
            legacySettings()?.autoApprovalEnabled !== undefined ||
            Boolean(legacySettings()?.allowedCommands?.length) ||
            Boolean(legacySettings()?.deniedCommands?.length),
          readPermission:
            legacySettings()?.alwaysAllowReadOnly !== undefined ||
            legacySettings()?.alwaysAllowReadOnlyOutsideWorkspace !== undefined,
          writePermission: legacySettings()?.alwaysAllowWrite !== undefined,
          executePermission: legacySettings()?.alwaysAllowExecute !== undefined,
          mcpPermission: legacySettings()?.alwaysAllowMcp !== undefined,
          taskPermission:
            legacySettings()?.alwaysAllowModeSwitch !== undefined ||
            legacySettings()?.alwaysAllowSubtasks !== undefined,
        }
      : {
          commandRules: false,
          readPermission: false,
          writePermission: false,
          executePermission: false,
          mcpPermission: false,
          taskPermission: false,
        }

    // Build progress entries
    const entries: ProgressEntry[] = [
      ...selectedProviderNames.map((name) => ({ item: name, group: "providers", status: "pending" as const })),
      ...selectedMcpNames.map((name) => ({ item: name, group: "mcpServers", status: "pending" as const })),
      ...selectedModesSlugs.map((slug) => {
        const mode = customModes().find((m) => m.slug === slug)
        return { item: mode?.name ?? slug, group: "customModes", status: "pending" as const }
      }),
      ...(migrateSessions()
        ? sessions().map((session) => ({ item: session.id, group: "sessions", status: "pending" as const }))
        : []),
      ...(migrateDefaultModel() && defaultModel()
        ? [{ item: "Default model", group: "defaultModel", status: "pending" as const }]
        : []),
      ...(autoApproval.commandRules
        ? [{ item: "Command rules", group: "autoApproval", status: "pending" as const }]
        : []),
      ...(autoApproval.readPermission
        ? [{ item: "Read permission", group: "autoApproval", status: "pending" as const }]
        : []),
      ...(autoApproval.writePermission
        ? [{ item: "Write permission", group: "autoApproval", status: "pending" as const }]
        : []),
      ...(autoApproval.executePermission
        ? [{ item: "Execute permission", group: "autoApproval", status: "pending" as const }]
        : []),
      ...(autoApproval.mcpPermission
        ? [{ item: "MCP permission", group: "autoApproval", status: "pending" as const }]
        : []),
      ...(autoApproval.taskPermission
        ? [{ item: "Task permission", group: "autoApproval", status: "pending" as const }]
        : []),
      ...(migrateLanguage() && legacySettings()?.language
        ? [{ item: "Language preference", group: "language", status: "pending" as const }]
        : []),
      ...(migrateAutocomplete() && legacySettings()?.autocomplete
        ? [{ item: "Autocomplete settings", group: "autocomplete", status: "pending" as const }]
        : []),
    ]

    setProgressEntries(entries)
    setSessionSummary(createSessionSummary())
    setSessionProgress(undefined)
    setRunning(true)
    setPhase("migrating")

    vscode.postMessage({
      type: "startLegacyMigration",
      selections: {
        providers: selectedProviderNames,
        mcpServers: selectedMcpNames,
        customModes: selectedModesSlugs,
        sessions: migrateSessions() ? sessions().map((session) => ({ id: session.id })) : [],
        defaultModel: migrateDefaultModel(),
        settings: {
          autoApproval,
          language: migrateLanguage(),
          autocomplete: migrateAutocomplete(),
        },
      },
    })
  }

  const handleForceReimport = (ids: string[]) => {
    dialog.show(() => (
      <ForceReimportDialog
        count={ids.length}
        onConfirm={() => {
          setRunning(true)
          setPhase("migrating")
          setSessionProgress(undefined)
          setResults((prev) => prev.filter((item) => item.category !== "session"))
          setProgressEntries((prev) => {
            const keep = prev.filter((item) => item.group !== "sessions")
            const next = ids.map((id) => ({ item: id, group: "sessions", status: "pending" as const }))
            return [...keep, ...next]
          })
          vscode.postMessage({
            type: "startLegacyMigration",
            selections: {
              providers: [],
              mcpServers: [],
              customModes: [],
              sessions: ids.map((id) => ({ id, force: true })),
              defaultModel: false,
              settings: {
                autoApproval: {
                  commandRules: false,
                  readPermission: false,
                  writePermission: false,
                  executePermission: false,
                  mcpPermission: false,
                  taskPermission: false,
                },
                language: false,
                autocomplete: false,
              },
            },
          })
          showToast({ variant: "success", title: language.t("migration.forceReimport.toast.started") })
        }}
      />
    ))
  }

  const handleDone = () => {
    if (running()) {
      dialog.show(() => (
        <RunningMigrationDialog
          onConfirm={() => {
            vscode.postMessage({ type: "finalizeLegacyMigration" })
            if (clearLegacyData()) {
              vscode.postMessage({ type: "clearLegacyData" })
            }
            props.onComplete()
          }}
        />
      ))
      return
    }
    vscode.postMessage({ type: "finalizeLegacyMigration" })
    if (clearLegacyData()) {
      vscode.postMessage({ type: "clearLegacyData" })
    }
    props.onComplete()
  }

  // ---------------------------------------------------------------------------
  // Data helpers
  // ---------------------------------------------------------------------------

  const supportedProviderCount = () => providers().filter((p) => p.supported && p.hasApiKey).length

  const hasAnyAutoApprovalData = () => {
    const s = legacySettings()
    return (
      s !== undefined &&
      (s.autoApprovalEnabled !== undefined ||
        Boolean(s.allowedCommands?.length) ||
        Boolean(s.deniedCommands?.length) ||
        s.alwaysAllowReadOnly !== undefined ||
        s.alwaysAllowReadOnlyOutsideWorkspace !== undefined ||
        s.alwaysAllowWrite !== undefined ||
        s.alwaysAllowExecute !== undefined ||
        s.alwaysAllowMcp !== undefined ||
        s.alwaysAllowModeSwitch !== undefined ||
        s.alwaysAllowSubtasks !== undefined)
    )
  }

  const hasLanguageData = () => Boolean(legacySettings()?.language)
  const hasAutocompleteData = () => Boolean(legacySettings()?.autocomplete)
  const hasSessions = () => sessions().length > 0

  const hasAnySelection = () =>
    (migrateProviders() && supportedProviderCount() > 0) ||
    (migrateMcpServers() && mcpServers().length > 0) ||
    (migrateModes() && customModes().length > 0) ||
    (migrateSessions() && hasSessions()) ||
    (migrateDefaultModel() && Boolean(defaultModel())) ||
    (migrateAutoApproval() && hasAnyAutoApprovalData()) ||
    (migrateLanguage() && hasLanguageData()) ||
    (migrateAutocomplete() && hasAutocompleteData())

  const hasNothingToShow = () =>
    supportedProviderCount() === 0 &&
    mcpServers().length === 0 &&
    customModes().length === 0 &&
    !hasSessions() &&
    !defaultModel() &&
    !hasAnyAutoApprovalData() &&
    !hasLanguageData() &&
    !hasAutocompleteData()

  // Group-level status for progress display
  const groupStatus = (group: string): ProgressEntry["status"] => {
    const entries = progressEntries().filter((entry) => entry.group === group)
    if (entries.length === 0) return "pending"
    if (group === "sessions" && running()) {
      if (entries.some((entry) => entry.status === "migrating" || entry.status === "pending")) return "migrating"
    }
    if (entries.some((entry) => entry.status === "error")) return "error"
    if (entries.some((entry) => entry.status === "warning")) return "warning"
    if (entries.every((entry) => entry.status === "success")) return "success"
    if (entries.some((entry) => entry.status === "migrating")) return "migrating"
    return "pending"
  }

  const successCount = () => results().filter((result) => result.status === "success").length
  const totalCount = () => results().length
  const groupMessage = (group: string) =>
    progressEntries().find((entry) => entry.group === group && entry.status === "error")?.message
  const sessionIconSpinning = () => phase() === "migrating" && migrateSessions() && hasSessions()

  // ---------------------------------------------------------------------------
  // Status icon renderer
  // ---------------------------------------------------------------------------

  const StatusIcon = (gProps: { group: string }): JSX.Element => {
    const status = () => groupStatus(gProps.group)
    const spinning = () => (gProps.group === "sessions" ? sessionIconSpinning() : status() === "migrating")
    return (
      <>
        <Show when={status() === "pending" && !spinning()}>
          <div class="migration-wizard__status-icon migration-wizard__status-icon--pending" />
        </Show>
        <Show when={spinning()}>
          <div class="migration-wizard__status-icon">
            <div class="migration-wizard__spinner" />
          </div>
        </Show>
        <Show when={status() === "success" && !spinning()}>
          <div class="migration-wizard__status-icon migration-wizard__status-icon--success">
            <SuccessCheckSvg />
          </div>
        </Show>
        <Show when={status() === "warning"}>
          <div class="migration-wizard__status-icon migration-wizard__status-icon--warning">
            <WarningSvg />
          </div>
        </Show>
        <Show when={status() === "error"}>
          <div class="migration-wizard__status-icon migration-wizard__status-icon--error">
            <ErrorXSvg />
          </div>
        </Show>
      </>
    )
  }

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div class="migration-wizard">
      <div class="migration-wizard__container">
        {/* ---- Screen 1: What's New ---- */}
        <div class={screen() === "whats-new" ? "migration-wizard__screen--active" : "migration-wizard__screen--hidden"}>
          <div class="migration-wizard__header">
            <KiloLogo />
            <h1>{language.t("migration.whatsNew.title")}</h1>
            <p>{language.t("migration.whatsNew.subtitle")}</p>
          </div>

          <div class="migration-wizard__features">
            <div class="migration-wizard__feature">
              <div class="migration-wizard__feature-icon">
                <BoltIcon />
              </div>
              <div class="migration-wizard__feature-text">
                <div class="title">{language.t("migration.whatsNew.features.performance.title")}</div>
                <div class="detail">{language.t("migration.whatsNew.features.performance.detail")}</div>
              </div>
            </div>

            <div class="migration-wizard__feature">
              <div class="migration-wizard__feature-icon">
                <MonitorIcon />
              </div>
              <div class="migration-wizard__feature-text">
                <div class="title">{language.t("migration.whatsNew.features.interface.title")}</div>
                <div class="detail">{language.t("migration.whatsNew.features.interface.detail")}</div>
              </div>
            </div>

            <div class="migration-wizard__feature">
              <div class="migration-wizard__feature-icon">
                <UsersIcon />
              </div>
              <div class="migration-wizard__feature-text">
                <div class="title">{language.t("migration.whatsNew.features.agentManager.title")}</div>
                <div class="detail">{language.t("migration.whatsNew.features.agentManager.detail")}</div>
              </div>
            </div>

            <div class="migration-wizard__feature">
              <div class="migration-wizard__feature-icon">
                <ServerIcon />
              </div>
              <div class="migration-wizard__feature-text">
                <div class="title">{language.t("migration.whatsNew.features.foundation.title")}</div>
                <div class="detail">{language.t("migration.whatsNew.features.foundation.detail")}</div>
              </div>
            </div>
          </div>

          <div class="migration-wizard__blog-link">
            <a href="https://blog.kilo.ai/p/new-kilo-for-vs-code-is-live">
              {language.t("migration.whatsNew.blogLink")} <span>&rarr;</span>
            </a>
          </div>

          <div class="migration-wizard__footer">
            <div class="migration-wizard__btn-group">
              <button
                type="button"
                class="migration-wizard__btn migration-wizard__btn--primary"
                onClick={() => setScreen("migrate")}
              >
                {language.t("migration.whatsNew.continue")}
              </button>
            </div>
          </div>
        </div>

        {/* ---- Screen 2: Migrate Settings ---- */}
        <div class={screen() === "migrate" ? "migration-wizard__screen--active" : "migration-wizard__screen--hidden"}>
          <div class="migration-wizard__header">
            <KiloLogo />
            <h1>{language.t("migration.migrate.title")}</h1>
            <p>{language.t("migration.migrate.subtitle")}</p>
          </div>

          <Show when={hasNothingToShow()}>
            <div class="migration-wizard__card">
              <div class="migration-wizard__empty">{language.t("migration.migrate.nothingToMigrate")}</div>
            </div>
          </Show>

          <Show when={!hasNothingToShow()}>
            <div class="migration-wizard__card">
              {/* Summary after migration */}
              <Show when={phase() === "done"}>
                <div
                  class={`migration-wizard__summary${successCount() > 0 ? " migration-wizard__summary--success" : ""}`}
                >
                  {language.t("migration.complete.summary", {
                    success: String(successCount()),
                    total: String(totalCount()),
                  })}
                </div>
              </Show>

              <div class="migration-wizard__section-label">{language.t("migration.migrate.selectLabel")}</div>

              {/* Provider API Keys */}
              <Show when={supportedProviderCount() > 0}>
                <div class="migration-wizard__item">
                  <Show when={phase() === "selecting"} fallback={<StatusIcon group="providers" />}>
                    <label class="migration-wizard__checkbox">
                      <input
                        type="checkbox"
                        checked={migrateProviders()}
                        onChange={(e) => setMigrateProviders(e.currentTarget.checked)}
                      />
                      <span class="migration-wizard__checkmark">
                        <CheckmarkSvg />
                      </span>
                    </label>
                  </Show>
                  <div class="migration-wizard__item-text">
                    <div class="label">{language.t("migration.select.providers")}</div>
                    <div class="desc">
                      {language.t("migration.migrate.keysDetected", {
                        count: String(supportedProviderCount()),
                      })}
                    </div>
                  </div>
                </div>
              </Show>

              {/* MCP Servers */}
              <Show when={mcpServers().length > 0}>
                <div class="migration-wizard__item">
                  <Show when={phase() === "selecting"} fallback={<StatusIcon group="mcpServers" />}>
                    <label class="migration-wizard__checkbox">
                      <input
                        type="checkbox"
                        checked={migrateMcpServers()}
                        onChange={(e) => setMigrateMcpServers(e.currentTarget.checked)}
                      />
                      <span class="migration-wizard__checkmark">
                        <CheckmarkSvg />
                      </span>
                    </label>
                  </Show>
                  <div class="migration-wizard__item-text">
                    <div class="label">{language.t("migration.select.mcpServers")}</div>
                    <div class="desc">
                      {language.t("migration.migrate.serversConfigured", {
                        count: String(mcpServers().length),
                      })}
                    </div>
                  </div>
                </div>
              </Show>

              {/* Custom Modes */}
              <Show when={customModes().length > 0}>
                <div class="migration-wizard__item">
                  <Show when={phase() === "selecting"} fallback={<StatusIcon group="customModes" />}>
                    <label class="migration-wizard__checkbox">
                      <input
                        type="checkbox"
                        checked={migrateModes()}
                        onChange={(e) => setMigrateModes(e.currentTarget.checked)}
                      />
                      <span class="migration-wizard__checkmark">
                        <CheckmarkSvg />
                      </span>
                    </label>
                  </Show>
                  <div class="migration-wizard__item-text">
                    <div class="label">{language.t("migration.select.customModes")}</div>
                    <div class="desc">
                      {language.t("migration.migrate.modesFound", {
                        count: String(customModes().length),
                      })}
                    </div>
                  </div>
                </div>
              </Show>

              <Show when={hasSessions()}>
                <div class="migration-wizard__item">
                  <Show when={phase() === "selecting"} fallback={<StatusIcon group="sessions" />}>
                    <label class="migration-wizard__checkbox">
                      <input
                        type="checkbox"
                        checked={migrateSessions()}
                        onChange={(e) => setMigrateSessions(e.currentTarget.checked)}
                      />
                      <span class="migration-wizard__checkmark">
                        <CheckmarkSvg />
                      </span>
                    </label>
                  </Show>
                  <div class="migration-wizard__item-text">
                    <div class="label">{language.t("migration.migrate.chatHistory")}</div>
                    <div class="desc">
                      {language.t("migration.migrate.sessionsDetected", { count: String(sessions().length) })}
                    </div>
                    <Show when={migrateSessions() && phase() !== "selecting" && sessionProgress()}>
                      <Show
                        when={sessionProgress()?.phase === "summary"}
                        fallback={<SessionMigrationProgress progress={sessionProgress()!} />}
                      >
                        <SessionMigrationSummary summary={sessionSummary()} onForce={handleForceReimport} />
                      </Show>
                    </Show>
                  </div>
                </div>
              </Show>

              {/* Default Model */}
              <Show when={Boolean(defaultModel())}>
                <div class="migration-wizard__item">
                  <Show when={phase() === "selecting"} fallback={<StatusIcon group="defaultModel" />}>
                    <label class="migration-wizard__checkbox">
                      <input
                        type="checkbox"
                        checked={migrateDefaultModel()}
                        onChange={(e) => setMigrateDefaultModel(e.currentTarget.checked)}
                      />
                      <span class="migration-wizard__checkmark">
                        <CheckmarkSvg />
                      </span>
                    </label>
                  </Show>
                  <div class="migration-wizard__item-text">
                    <div class="label">{language.t("migration.select.defaultModel")}</div>
                  </div>
                </div>
              </Show>

              {/* Auto-Approval */}
              <Show when={hasAnyAutoApprovalData()}>
                <div class="migration-wizard__item">
                  <Show when={phase() === "selecting"} fallback={<StatusIcon group="autoApproval" />}>
                    <label class="migration-wizard__checkbox">
                      <input
                        type="checkbox"
                        checked={migrateAutoApproval()}
                        onChange={(e) => setMigrateAutoApproval(e.currentTarget.checked)}
                      />
                      <span class="migration-wizard__checkmark">
                        <CheckmarkSvg />
                      </span>
                    </label>
                  </Show>
                  <div class="migration-wizard__item-text">
                    <div class="label">{language.t("migration.select.autoApproval")}</div>
                  </div>
                </div>
              </Show>

              {/* Language */}
              <Show when={hasLanguageData()}>
                <div class="migration-wizard__item">
                  <Show when={phase() === "selecting"} fallback={<StatusIcon group="language" />}>
                    <label class="migration-wizard__checkbox">
                      <input
                        type="checkbox"
                        checked={migrateLanguage()}
                        onChange={(e) => setMigrateLanguage(e.currentTarget.checked)}
                      />
                      <span class="migration-wizard__checkmark">
                        <CheckmarkSvg />
                      </span>
                    </label>
                  </Show>
                  <div class="migration-wizard__item-text">
                    <div class="label">{language.t("migration.select.language")}</div>
                  </div>
                </div>
              </Show>

              {/* Autocomplete */}
              <Show when={hasAutocompleteData()}>
                <div class="migration-wizard__item">
                  <Show when={phase() === "selecting"} fallback={<StatusIcon group="autocomplete" />}>
                    <label class="migration-wizard__checkbox">
                      <input
                        type="checkbox"
                        checked={migrateAutocomplete()}
                        onChange={(e) => setMigrateAutocomplete(e.currentTarget.checked)}
                      />
                      <span class="migration-wizard__checkmark">
                        <CheckmarkSvg />
                      </span>
                    </label>
                  </Show>
                  <div class="migration-wizard__item-text">
                    <div class="label">{language.t("migration.select.autocomplete")}</div>
                  </div>
                </div>
              </Show>

              {/* Cleanup option after done */}
              {/*
              <Show when={phase() === "done"}>
                <div class="migration-wizard__divider" />
                <div class="migration-wizard__item migration-wizard__item--clickable">
                  <label class="migration-wizard__checkbox">
                    <input
                      type="checkbox"
                      checked={clearLegacyData()}
                      onChange={(e) => setClearLegacyData(e.currentTarget.checked)}
                    />
                    <span class="migration-wizard__checkmark">
                      <CheckmarkSvg />
                    </span>
                  </label>
                  <div class="migration-wizard__item-text" onClick={() => setClearLegacyData((v) => !v)}>
                    <div class="label">{language.t("migration.complete.cleanup")}</div>
                    <div class="desc">{language.t("migration.complete.cleanupDescription")}</div>
                  </div>
                </div>
              </Show>
              */}
            </div>
          </Show>

          {/* Footer */}
          <div class="migration-wizard__footer">
            <div class="migration-wizard__btn-group">
              <Show when={phase() === "selecting"}>
                <button
                  type="button"
                  class="migration-wizard__btn migration-wizard__btn--ghost"
                  onClick={() => setScreen("whats-new")}
                >
                  {language.t("common.goBack")}
                </button>
                <button type="button" class="migration-wizard__btn migration-wizard__btn--ghost" onClick={handleSkip}>
                  {language.t("migration.migrate.skip")}
                </button>
                <button
                  type="button"
                  class="migration-wizard__btn migration-wizard__btn--primary"
                  disabled={!hasAnySelection()}
                  onClick={handleStartMigration}
                >
                  {language.t("migration.migrate.button")}
                </button>
              </Show>
              <Show when={phase() === "migrating"}>
                <button type="button" class="migration-wizard__btn migration-wizard__btn--primary" disabled>
                  {language.t("migration.migrate.button")}
                </button>
              </Show>
              <Show when={phase() === "error"}>
                <button
                  type="button"
                  class="migration-wizard__btn migration-wizard__btn--primary"
                  onClick={() => {
                    vscode.postMessage({ type: "loadSessions" })
                    setPhase("done")
                  }}
                >
                  {language.t("migration.error.continue")}
                </button>
              </Show>
              <Show when={phase() === "done"}>
                <button type="button" class="migration-wizard__btn migration-wizard__btn--primary" onClick={handleDone}>
                  {language.t("migration.complete.done")}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MigrationWizard
