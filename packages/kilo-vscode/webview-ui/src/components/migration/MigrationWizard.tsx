/**
 * legacy-migration - Multi-step migration wizard UI component.
 *
 * Screens:
 *   1. What's New  — feature showcase for the new extension
 *   2. Migrate     — grouped selection, live in-place progress, cleanup
 */

import { Component, Show, createSignal, onMount, onCleanup, JSX } from "solid-js"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type {
  MigrationProviderInfo,
  MigrationMcpServerInfo,
  MigrationCustomModeInfo,
  MigrationResultItem,
  MigrationAutoApprovalSelections,
  LegacySettings,
  LegacyMigrationDataMessage,
  LegacyMigrationProgressMessage,
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
type MigratePhase = "selecting" | "migrating" | "done"

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
  const language = useLanguage()

  const [screen, setScreen] = createSignal<Screen>("whats-new")
  const [phase, setPhase] = createSignal<MigratePhase>("selecting")

  // Data from extension
  const [providers, setProviders] = createSignal<MigrationProviderInfo[]>([])
  const [mcpServers, setMcpServers] = createSignal<MigrationMcpServerInfo[]>([])
  const [customModes, setCustomModes] = createSignal<MigrationCustomModeInfo[]>([])
  const [defaultModel, setDefaultModel] = createSignal<{ provider: string; model: string } | undefined>(undefined)
  const [legacySettings, setLegacySettings] = createSignal<LegacySettings | undefined>(undefined)

  // Group-level selections
  const [migrateProviders, setMigrateProviders] = createSignal(true)
  const [migrateMcpServers, setMigrateMcpServers] = createSignal(true)
  const [migrateModes, setMigrateModes] = createSignal(true)
  const [migrateDefaultModel, setMigrateDefaultModel] = createSignal(true)
  const [migrateAutoApproval, setMigrateAutoApproval] = createSignal(true)
  const [migrateLanguage, setMigrateLanguage] = createSignal(true)
  const [migrateAutocomplete, setMigrateAutocomplete] = createSignal(true)

  // Progress tracking
  const [progressEntries, setProgressEntries] = createSignal<ProgressEntry[]>([])
  const [results, setResults] = createSignal<MigrationResultItem[]>([])

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
        setDefaultModel(data.defaultModel)
        setLegacySettings(data.settings)

        // Pre-select groups that have data
        setMigrateProviders(data.providers.some((p) => p.supported && p.hasApiKey))
        setMigrateMcpServers(data.mcpServers.length > 0)
        setMigrateModes(data.customModes.length > 0)
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
            group: existing >= 0 ? prev[existing].group : update.item,
            status: update.status,
            message: update.message,
          }
          return existing >= 0 ? prev.map((e, i) => (i === existing ? entry : e)) : [...prev, entry]
        })
      }

      if (msg?.type === "legacyMigrationComplete") {
        const complete = msg as LegacyMigrationCompleteMessage
        setResults(complete.results)
        setPhase("done")
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
    setPhase("migrating")

    vscode.postMessage({
      type: "startLegacyMigration",
      selections: {
        providers: selectedProviderNames,
        mcpServers: selectedMcpNames,
        customModes: selectedModesSlugs,
        defaultModel: migrateDefaultModel(),
        settings: {
          autoApproval,
          language: migrateLanguage(),
          autocomplete: migrateAutocomplete(),
        },
      },
    })
  }

  const handleDone = () => {
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

  const hasAnySelection = () =>
    (migrateProviders() && supportedProviderCount() > 0) ||
    (migrateMcpServers() && mcpServers().length > 0) ||
    (migrateModes() && customModes().length > 0) ||
    (migrateDefaultModel() && Boolean(defaultModel())) ||
    (migrateAutoApproval() && hasAnyAutoApprovalData()) ||
    (migrateLanguage() && hasLanguageData()) ||
    (migrateAutocomplete() && hasAutocompleteData())

  const hasNothingToShow = () =>
    supportedProviderCount() === 0 &&
    mcpServers().length === 0 &&
    customModes().length === 0 &&
    !defaultModel() &&
    !hasAnyAutoApprovalData() &&
    !hasLanguageData() &&
    !hasAutocompleteData()

  // Group-level status for progress display
  const groupStatus = (group: string): ProgressEntry["status"] => {
    const entries = progressEntries().filter((e) => e.group === group)
    if (entries.length === 0) return "pending"
    if (entries.some((e) => e.status === "error")) return "error"
    if (entries.some((e) => e.status === "warning")) return "warning"
    if (entries.every((e) => e.status === "success")) return "success"
    if (entries.some((e) => e.status === "migrating")) return "migrating"
    return "pending"
  }

  const successCount = () => results().filter((r) => r.status === "success").length
  const totalCount = () => results().length

  // ---------------------------------------------------------------------------
  // Status icon renderer
  // ---------------------------------------------------------------------------

  const StatusIcon = (gProps: { group: string }): JSX.Element => {
    const status = () => groupStatus(gProps.group)
    return (
      <>
        <Show when={status() === "pending"}>
          <div class="migration-wizard__status-icon migration-wizard__status-icon--pending" />
        </Show>
        <Show when={status() === "migrating"}>
          <div class="migration-wizard__status-icon">
            <div class="migration-wizard__spinner" />
          </div>
        </Show>
        <Show when={status() === "success"}>
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
            <h1>
              {language.t("migration.whatsNew.title")}{" "}
              <span class="migration-wizard__badge">{language.t("migration.whatsNew.badge")}</span>
            </h1>
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
            <a href="https://blog.kilo.ai/we-completely-rebuilt-the-kilo-vs-code-extension">
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

              {/* Divider + Cannot be migrated */}
              <div class="migration-wizard__divider" />
              <div class="migration-wizard__section-label">{language.t("migration.migrate.cannotMigrate")}</div>
              <div class="migration-wizard__item migration-wizard__item--disabled">
                <label class="migration-wizard__checkbox">
                  <input type="checkbox" disabled />
                  <span class="migration-wizard__checkmark" />
                </label>
                <div class="migration-wizard__item-text">
                  <div class="label">{language.t("migration.migrate.chatHistory")}</div>
                  <div class="desc">{language.t("migration.migrate.chatHistoryDesc")}</div>
                </div>
              </div>

              {/* Cleanup option after done */}
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
                  {language.t("migration.migrate.back")}
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
