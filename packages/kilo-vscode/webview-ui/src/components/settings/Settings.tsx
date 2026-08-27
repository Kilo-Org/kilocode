import { Component, createSignal, createEffect, createMemo, on, Show, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import ModelsTab from "./ModelsTab"
import ProvidersTab from "./ProvidersTab"
import AgentBehaviourTab from "./AgentBehaviourTab"
import AutoApproveTab from "./AutoApproveTab"
import BrowserTab from "./BrowserTab"
import CheckpointsTab from "./CheckpointsTab"
import DisplayTab from "./DisplayTab"
import AutocompleteTab from "./AutocompleteTab"
import NotificationsTab from "./NotificationsTab"
import ContextTab from "./ContextTab"

import CommitMessageTab from "./CommitMessageTab"
import ExperimentalTab from "./ExperimentalTab"
import LanguageTab from "./LanguageTab"
import AboutKiloCodeTab from "./AboutKiloCodeTab"
import IndexingTab from "./IndexingTab"
import SandboxingTab from "./SandboxingTab"
import * as Sandboxing from "./sandboxing"
import { useServer } from "../../context/server"
import type { MigrationSource } from "../../types/messages"
import { configMessage } from "../../utils/open-config"
import type {
  AgentManagerSettingsBranchesLoadedMessage,
  AgentManagerSettingsLoadedMessage,
  AgentManagerSettingsProject,
  ExtensionMessage,
} from "../../types/messages"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import SettingsRow from "./SettingsRow"
import { ProjectBranchDialog } from "../../../agent-manager/ProjectBranchDialog"

export interface SettingsProps {
  tab?: string
  agentManagerProjectId?: string
  agentManagerSettings?: boolean
  onTabChange?: (tab: string) => void
  onMigrationClick?: (source: MigrationSource) => void // legacy-migration
}

const AgentManagerTab: Component<{ projectId?: string }> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const [projects, setProjects] = createSignal<AgentManagerSettingsProject[]>([])
  const remembered = vscode.getState<{ agentManagerProjectId?: string }>()?.agentManagerProjectId
  const [selected, setSelected] = createSignal<string | undefined>(props.projectId ?? remembered)
  const [branches, setBranches] = createSignal<AgentManagerSettingsBranchesLoadedMessage>()
  const [branchLoading, setBranchLoading] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  let count = 0
  let latestSettings = ""
  let latestBranches = ""
  const issue = () => {
    return `${Date.now() * 1000 + ++count}`
  }
  const scriptPath = () =>
    projects().find((item) => item.id === selected())?.setupScriptPath ?? branches()?.setupScriptPath
  const load = (projectId?: string) => {
    if (!projectId) return
    setSelected(projectId)
    setBranches(undefined)
    setBranchLoading(false)
    vscode.setState({ ...vscode.getState<Record<string, unknown>>(), agentManagerProjectId: projectId })
    latestSettings = issue()
    latestBranches = latestSettings
    vscode.postMessage({ type: "requestAgentManagerSettings", projectId, requestId: latestSettings })
  }
  const loadBranches = (projectId?: string) => {
    if (!projectId || (branches()?.projectId === projectId && !branches()?.error) || branchLoading()) return
    setBranchLoading(true)
    latestBranches = issue()
    vscode.postMessage({ type: "requestAgentManagerSettingsBranches", projectId, requestId: latestBranches })
  }
  createEffect(() => {
    if (props.projectId && props.projectId !== selected()) load(props.projectId)
  })
  const onMessage = (message: ExtensionMessage) => {
    if (message.type === "agentManagerSettingsLoaded") {
      const event = message as AgentManagerSettingsLoadedMessage
      if (event.requestId !== latestSettings) return
      setProjects(event.projects)
      const current = selected()
      const next = event.projects.some((project) => project.id === current) ? current : event.projectId
      setSelected(next)
      setLoading(false)
      return
    }
    if (message.type === "agentManagerSettingsBranchesLoaded") {
      const event = message as AgentManagerSettingsBranchesLoadedMessage
      if (event.requestId !== latestBranches) return
      if (event.projectId === selected()) {
        setBranches(event.error ? undefined : event)
        setBranchLoading(false)
      }
    }
  }
  const initial = props.projectId ?? remembered
  const timeout = setTimeout(() => setLoading(false), 3000)
  const unsubscribe = vscode.onMessage(onMessage)
  onCleanup(() => {
    unsubscribe()
    clearTimeout(timeout)
  })
  latestSettings = issue()
  vscode.postMessage({ type: "requestAgentManagerSettings", projectId: initial, requestId: latestSettings })
  const project = () => projects().find((item) => item.id === selected())
  const projectText = (item: AgentManagerSettingsProject) => `${item.label} - ${item.root}`
  const branchLabel = () => {
    const data = branches()
    const configured = data ? data.configuredBaseBranch : project()?.defaultBaseBranch
    if (configured) return configured
    const detected = data?.defaultBranch ?? project()?.defaultBranch
    return `${language.t("agentManager.worktree.defaultBaseBranchAuto")}${detected ? ` (${detected})` : ""}`
  }
  const setBranch = (branch?: string) => {
    const id = selected()
    if (!id) return
    setBranches((current) => (current ? { ...current, configuredBaseBranch: branch } : current))
    latestSettings = issue()
    latestBranches = latestSettings
    vscode.postMessage({ type: "setAgentManagerDefaultBaseBranch", projectId: id, branch, requestId: latestSettings })
  }
  const openBranches = () => {
    const id = selected()
    if (!id || project()?.missing) return
    loadBranches(id)
    dialog.show(() => (
      <ProjectBranchDialog
        selected={branches()?.configuredBaseBranch ?? project()?.defaultBaseBranch}
        detected={branches()?.defaultBranch ?? project()?.defaultBranch}
        branches={() => branches()?.branches ?? []}
        loading={branchLoading}
        onClose={() => dialog.close()}
        onSelect={setBranch}
      />
    ))
  }
  return (
    <Show when={!loading()} fallback={<Spinner />}>
      <div class="settings-agent-manager">
        <Card>
          <SettingsRow
            title={language.t("agentManager.settings.project.title")}
            description={language.t("agentManager.settings.project.description")}
          >
            <Select
              options={projects()}
              current={project()}
              value={(item) => item.id}
              label={projectText}
              onSelect={(item) => load(item?.id)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              triggerProps={{ title: project()?.root }}
              children={(item) => (item ? <span title={projectText(item)}>{projectText(item)}</span> : "")}
            />
          </SettingsRow>
          <Show when={project()} fallback={<p>{language.t("agentManager.settings.project.empty")}</p>}>
            <SettingsRow
              title={language.t("agentManager.worktree.defaultBaseBranch")}
              description={language.t("agentManager.settings.defaultBaseBranch.description")}
            >
              <Button
                variant="secondary"
                size="small"
                class="settings-branch-trigger"
                title={branchLabel()}
                disabled={project()?.missing || branchLoading()}
                onClick={openBranches}
              >
                <span class="settings-branch-trigger-label">{branchLabel()}</span>
                <Icon name="selector" size="small" />
              </Button>
            </SettingsRow>
            <SettingsRow
              title={language.t("agentManager.worktree.setupScript")}
              description={language.t("agentManager.settings.setupScript.description")}
              last
            >
              <Button
                variant="secondary"
                size="small"
                icon="edit"
                disabled={project()?.missing}
                onClick={() =>
                  vscode.postMessage({
                    type: "configureAgentManagerSetupScript",
                    projectId: selected()!,
                    requestId: (latestSettings = issue()),
                  })
                }
              >
                {scriptPath()
                  ? language.t("agentManager.settings.setupScript.edit")
                  : language.t("agentManager.settings.setupScript.create")}
              </Button>
            </SettingsRow>
          </Show>
        </Card>
      </div>
    </Show>
  )
}

const Settings: Component<SettingsProps> = (props) => {
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const { loading, isDirty, saving, saveError, saveConfig, discardConfig, features } = useConfig()
  const session = useSession()
  const [active, setActive] = createSignal(props.tab ?? "models")
  const [errorExpanded, setErrorExpanded] = createSignal(false)
  const sandboxing = createMemo(() => Sandboxing.visible(features()))

  const busyCount = () => Object.values(session.allStatusMap()).filter((s) => s.type === "busy").length

  const handleSave = () => {
    const busy = busyCount()
    if (busy === 0) {
      saveConfig()
      return
    }
    const msg = busy === 1 ? language.t("settings.saveBar.warning.one") : language.t("settings.saveBar.warning.many")
    showToast({
      variant: "error",
      title: msg,
      persistent: true,
      actions: [
        { label: language.t("settings.saveBar.saveAnyway"), onClick: saveConfig },
        { label: language.t("settings.saveBar.cancel"), onClick: "dismiss" },
      ],
    })
  }

  const open = (scope: "local" | "global") => {
    vscode.postMessage(configMessage(scope, language.t))
  }

  // Sync when the parent changes the tab prop (e.g. via navigate message)
  createEffect(
    on(
      () => props.tab,
      (tab) => {
        if (tab) setActive(tab)
      },
    ),
  )

  createEffect(() => {
    if (features().indexing || active() !== "indexing") return
    onTabChange("providers")
  })

  createEffect(() => {
    if (loading() || sandboxing() || active() !== "sandboxing") return
    onTabChange("experimental")
  })

  const onTabChange = (tab: string) => {
    setActive(tab)
    props.onTabChange?.(tab)
    vscode.postMessage({ type: "settingsTabChanged", tab })
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": 0 }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": "1px solid var(--border-weak-base)",
          display: "flex",
          "align-items": "center",
          "flex-wrap": "wrap",
          gap: "8px",
        }}
      >
        <h2 style={{ "font-size": "var(--kilo-font-size-16)", "font-weight": "600", margin: 0, flex: 1 }}>
          {language.t("sidebar.settings")}
        </h2>
        <Button variant="secondary" size="small" icon="edit" onClick={() => open("local")}>
          {language.t("settings.openLocalConfig")}
        </Button>
        <Button variant="secondary" size="small" icon="edit" onClick={() => open("global")}>
          {language.t("settings.openGlobalConfig")}
        </Button>
        <Tooltip value={language.t("common.reloadDescription")} placement="bottom">
          <Button variant="secondary" size="small" onClick={() => vscode.postMessage({ type: "reload" })}>
            <Icon name="reload" size="small" />
            {language.t("common.reload")}
          </Button>
        </Tooltip>
      </div>

      {/* Settings tabs */}
      <Tabs
        orientation="vertical"
        variant="settings"
        value={active()}
        onChange={onTabChange}
        style={{ flex: 1, overflow: "hidden" }}
      >
        <Tabs.List>
          <Tabs.Trigger value="models" aria-label={language.t("settings.models.title")}>
            <Icon name="models" />
            <span class="label">{language.t("settings.models.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="providers" aria-label={language.t("settings.providers.title")}>
            <Icon name="providers" />
            <span class="label">{language.t("settings.providers.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="agentBehaviour" aria-label={language.t("settings.agentBehaviour.title")}>
            <Icon name="brain" />
            <span class="label">{language.t("settings.agentBehaviour.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="autoApprove" aria-label={language.t("settings.autoApprove.title")}>
            <Icon name="checklist" />
            <span class="label">{language.t("settings.autoApprove.title")}</span>
          </Tabs.Trigger>
          <Show when={props.agentManagerSettings}>
            <Tabs.Trigger value="agentManager" aria-label={language.t("agentManager.settings.title")}>
              <Icon name="settings-gear" />
              <span class="label">{language.t("agentManager.settings.title")}</span>
            </Tabs.Trigger>
          </Show>
          <Tabs.Trigger value="browser" aria-label={language.t("settings.webTools.title")}>
            <Icon name="window-cursor" />
            <span class="label">{language.t("settings.webTools.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="checkpoints" aria-label={language.t("settings.checkpoints.title")}>
            <Icon name="branch" />
            <span class="label">{language.t("settings.checkpoints.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="display" aria-label={language.t("settings.display.title")}>
            <Icon name="eye" />
            <span class="label">{language.t("settings.display.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="autocomplete" aria-label={language.t("settings.autocomplete.title")}>
            <Icon name="code-lines" />
            <span class="label">{language.t("settings.autocomplete.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="notifications" aria-label={language.t("settings.notifications.title")}>
            <Icon name="circle-check" />
            <span class="label">{language.t("settings.notifications.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="context" aria-label={language.t("settings.context.title")}>
            <Icon name="server" />
            <span class="label">{language.t("settings.context.title")}</span>
          </Tabs.Trigger>

          <Tabs.Trigger value="commitMessage" aria-label={language.t("settings.commitMessage.title")}>
            <Icon name="edit" />
            <span class="label">{language.t("settings.commitMessage.title")}</span>
          </Tabs.Trigger>
          <Show when={features().indexing}>
            <Tabs.Trigger value="indexing" aria-label={language.t("settings.indexing.title")}>
              <Icon name="database" />
              <span class="label">{language.t("settings.indexing.title")}</span>
            </Tabs.Trigger>
          </Show>
          <Tabs.Trigger value="experimental" aria-label={language.t("settings.experimental.title")}>
            <Icon name="settings-gear" />
            <span class="label">{language.t("settings.experimental.title")}</span>
          </Tabs.Trigger>
          <Show when={sandboxing()}>
            <Tabs.Trigger value="sandboxing" aria-label={language.t("settings.sandboxing.title")}>
              <Icon name="shield" />
              <span class="label">{language.t("settings.sandboxing.title")}</span>
            </Tabs.Trigger>
          </Show>
          <Tabs.Trigger value="language" aria-label={language.t("settings.language.title")}>
            <Icon name="speech-bubble" />
            <span class="label">{language.t("settings.language.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="aboutKiloCode" aria-label={language.t("settings.aboutKiloCode.title")}>
            <Icon name="help" />
            <span class="label">{language.t("settings.aboutKiloCode.title")}</span>
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="models">
          <h3>{language.t("settings.models.title")}</h3>
          <ModelsTab />
        </Tabs.Content>
        <Tabs.Content value="providers">
          <h3>{language.t("settings.providers.title")}</h3>
          <ProvidersTab />
        </Tabs.Content>
        <Tabs.Content value="agentBehaviour">
          <h3>{language.t("settings.agentBehaviour.title")}</h3>
          <AgentBehaviourTab />
        </Tabs.Content>
        <Tabs.Content value="autoApprove">
          <h3>{language.t("settings.autoApprove.title")}</h3>
          <AutoApproveTab />
        </Tabs.Content>
        <Show when={props.agentManagerSettings}>
          <Tabs.Content value="agentManager">
            <h3>{language.t("agentManager.settings.title")}</h3>
            <AgentManagerTab projectId={props.agentManagerProjectId} />
          </Tabs.Content>
        </Show>
        <Tabs.Content value="browser">
          <h3>{language.t("settings.webTools.title")}</h3>
          <BrowserTab />
        </Tabs.Content>
        <Tabs.Content value="checkpoints">
          <h3>{language.t("settings.checkpoints.title")}</h3>
          <CheckpointsTab />
        </Tabs.Content>
        <Tabs.Content value="display">
          <h3>{language.t("settings.display.title")}</h3>
          <DisplayTab />
        </Tabs.Content>
        <Tabs.Content value="autocomplete">
          <h3>{language.t("settings.autocomplete.title")}</h3>
          <AutocompleteTab onNavigateToModels={() => onTabChange("models")} />
        </Tabs.Content>
        <Tabs.Content value="notifications">
          <h3>{language.t("settings.notifications.title")}</h3>
          <NotificationsTab />
        </Tabs.Content>
        <Tabs.Content value="context">
          <h3>{language.t("settings.context.title")}</h3>
          <ContextTab />
        </Tabs.Content>

        <Tabs.Content value="commitMessage">
          <h3>{language.t("settings.commitMessage.title")}</h3>
          <CommitMessageTab />
        </Tabs.Content>
        <Show when={features().indexing}>
          <Tabs.Content value="indexing">
            <h3>{language.t("settings.indexing.title")}</h3>
            <IndexingTab />
          </Tabs.Content>
        </Show>
        <Tabs.Content value="experimental">
          <h3>{language.t("settings.experimental.title")}</h3>
          <ExperimentalTab />
        </Tabs.Content>
        <Show when={sandboxing()}>
          <Tabs.Content value="sandboxing">
            <h3>{language.t("settings.sandboxing.title")}</h3>
            <SandboxingTab />
          </Tabs.Content>
        </Show>
        <Tabs.Content value="language">
          <h3>{language.t("settings.language.title")}</h3>
          <LanguageTab />
        </Tabs.Content>
        <Tabs.Content value="aboutKiloCode">
          <h3>{language.t("settings.aboutKiloCode.title")}</h3>
          <AboutKiloCodeTab
            port={server.serverInfo()?.port ?? null}
            connectionState={server.connectionState()}
            extensionVersion={server.extensionVersion()}
            onMigrationClick={props.onMigrationClick}
          />
        </Tabs.Content>
      </Tabs>

      {/* Save bar — slides in when there are unsaved config changes */}
      <Show when={isDirty()}>
        <div class="settings-save-bar-wrap">
          <Show when={saveError()}>
            {(err) => (
              <div class="settings-save-bar-error">
                <div
                  class="settings-save-bar-error-header"
                  onClick={() => setErrorExpanded((v) => !v)}
                  role="button"
                  aria-expanded={errorExpanded()}
                >
                  <span
                    class={`settings-save-bar-error-chevron${
                      errorExpanded() ? " settings-save-bar-error-chevron-expanded" : ""
                    }`}
                  >
                    <Icon name="chevron-right" size="small" />
                  </span>
                  <span class="settings-save-bar-error-title">
                    {language.t("settings.saveBar.saveFailed")}:{" "}
                    <span class="settings-save-bar-error-firstline">{err().message}</span>
                  </span>
                </div>
                <Show when={errorExpanded()}>
                  <pre class="settings-save-bar-error-details">{err().details ?? err().message}</pre>
                </Show>
              </div>
            )}
          </Show>
          <div class="settings-save-bar">
            <span class="settings-save-bar-label">{language.t("settings.saveBar.unsavedChanges")}</span>
            <Button variant="ghost" size="small" onClick={discardConfig} disabled={saving()}>
              {language.t("settings.saveBar.discard")}
            </Button>
            <Button variant="primary" size="small" onClick={handleSave} disabled={saving()}>
              {saving() ? language.t("settings.saveBar.saving") : language.t("settings.saveBar.save")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default Settings
