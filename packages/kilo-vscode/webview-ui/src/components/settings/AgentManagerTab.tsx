// The Agent Manager settings rows, ported from v1 Settings.tsx. They edit one Agent Manager project at a time, so the
// tab carries the project the gear selected and asks the host for that project's branches and setup script. The
// project data lives in the provider, not in the panel's own directory.
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createEffect, createSignal, on, onCleanup, onMount, Show, type Component } from "solid-js"
import { ProjectBranchDialog } from "../../../agent-manager/ProjectBranchDialog"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { AgentManagerSettingsBranchPayload, AgentManagerSettingsProject, ToHost, ToWebview } from "../../../../src/protocol"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import Switch from "./Switch"
import type { SettingsTabProps } from "./tabs"

const AgentManagerTab: Component<SettingsTabProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const config = useSettingsConfig()
  const dialog = useDialog()

  const [projects, setProjects] = createSignal<AgentManagerSettingsProject[]>([])
  const [selected, setSelected] = createSignal<string | undefined>(props.projectId)
  const [branches, setBranches] = createSignal<AgentManagerSettingsBranchPayload>()
  const [branchLoading, setBranchLoading] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [prefix, setPrefix] = createSignal<string>()

  let count = 0
  let latestSettings = ""
  let latestBranches = ""
  const issue = () => `${Date.now() * 1000 + ++count}`

  const project = () => projects().find((item) => item.id === selected())
  const projectText = (item: AgentManagerSettingsProject) => `${item.label} - ${item.root}`
  const scriptPath = () => project()?.setupScriptPath ?? branches()?.setupScriptPath
  const branchLabel = () => {
    const configured = branches()?.configuredBaseBranch ?? project()?.defaultBaseBranch
    if (configured) return configured
    const detected = branches()?.defaultBranch
    return `${language.t("agentManager.worktree.defaultBaseBranchAuto")}${detected ? ` (${detected})` : ""}`
  }

  const post = (message: ToHost) => vscode.postMessage(message as never)

  const load = (projectId?: string) => {
    if (projectId) setSelected(projectId)
    setBranches(undefined)
    setBranchLoading(false)
    latestSettings = issue()
    latestBranches = latestSettings
    post({ type: "agentManagerSettings", projectId, requestId: latestSettings })
  }

  const loadBranches = (projectId?: string) => {
    if (!projectId || branchLoading()) return
    setBranchLoading(true)
    latestBranches = issue()
    post({ type: "agentManagerSettingsBranches", projectId, requestId: latestBranches })
  }

  const onMessage = (raw: unknown) => {
    const message = raw as ToWebview
    if (message.type === "agentManagerSettingsLoaded") {
      if (message.requestId !== latestSettings) return
      setProjects(message.projects)
      const current = selected()
      const next = message.projects.some((item) => item.id === current)
        ? current
        : (message.projectId ?? message.projects[0]?.id)
      setSelected(next)
      setLoading(false)
      return
    }
    if (message.type === "agentManagerSettingsBranchesLoaded") {
      if (message.requestId !== latestBranches) return
      if (message.projectId !== selected()) return
      setBranches(message.error ? undefined : message)
      setBranchLoading(false)
    }
  }

  onMount(() => {
    const unsubscribe = vscode.onMessage(onMessage)
    onCleanup(unsubscribe)
    load(props.projectId)
  })
  createEffect(
    on(
      () => props.projectId,
      (projectId) => {
        if (projectId && projectId !== selected()) load(projectId)
      },
    ),
  )

  const openBranches = () => {
    const id = selected()
    if (!id || project()?.missing) return
    loadBranches(id)
    dialog.show(() => (
      <ProjectBranchDialog
        selected={branches()?.configuredBaseBranch ?? project()?.defaultBaseBranch}
        detected={branches()?.defaultBranch}
        branches={() => branches()?.branches ?? []}
        loading={branchLoading}
        onClose={() => dialog.close()}
        onSelect={setBranch}
      />
    ))
  }

  const setBranch = (branch?: string) => {
    const id = selected()
    if (!id) return
    setBranches((current) => (current ? { ...current, configuredBaseBranch: branch } : current))
    latestSettings = issue()
    latestBranches = latestSettings
    post({ type: "agentManagerSetDefaultBaseBranch", projectId: id, branch, requestId: latestSettings })
  }

  const configureScript = () => {
    const id = selected()
    if (!id) return
    latestSettings = issue()
    post({ type: "agentManagerConfigureSetupScript", projectId: id, requestId: latestSettings })
  }

  const storedPrefix = () => {
    const value = config.setting("agentManager.branchPrefix")
    return typeof value === "string" ? value : ""
  }
  const commitPrefix = () => {
    const next = prefix()
    setPrefix(undefined)
    if (next === undefined || next === storedPrefix()) return
    config.setSetting("agentManager.branchPrefix", next)
  }

  return (
    <Show when={!loading()} fallback={<p>{language.t("common.loading")}</p>}>
      <div class="settings-agent-manager">
        <Card>
          <SettingsRow
            title={language.t("agentManager.settings.autoBranchNaming.title")}
            description={language.t("agentManager.settings.autoBranchNaming.description")}
          >
            <Switch
              checked={config.setting("agentManager.autoBranchNaming") !== false}
              onChange={(checked) => config.setSetting("agentManager.autoBranchNaming", checked)}
              hideLabel
            >
              {language.t("agentManager.settings.autoBranchNaming.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("agentManager.settings.branchPrefix.title")}
            description={language.t("agentManager.settings.branchPrefix.description")}
          >
            <div style={{ width: "200px" }}>
              <TextField
                label={language.t("agentManager.settings.branchPrefix.title")}
                hideLabel
                value={prefix() ?? storedPrefix()}
                placeholder="feature/"
                onChange={(value) => setPrefix(value)}
                onBlur={commitPrefix}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  commitPrefix()
                }}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title={language.t("agentManager.settings.worktreePool.title")}
            description={language.t("agentManager.settings.worktreePool.description")}
          >
            <Switch
              checked={config.setting("agentManager.worktreePool") !== false}
              onChange={(checked) => config.setSetting("agentManager.worktreePool", checked)}
              hideLabel
            >
              {language.t("agentManager.settings.worktreePool.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("agentManager.settings.project.title")}
            description={language.t("agentManager.settings.project.description")}
          >
            <Select
              options={projects()}
              current={project()}
              value={(item: AgentManagerSettingsProject) => item.id}
              label={projectText}
              onSelect={(item: AgentManagerSettingsProject | undefined) => {
                if (item) load(item.id)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              triggerProps={{ title: project()?.root }}
            />
          </SettingsRow>
          <Show
            when={project()}
            fallback={<p>{language.t("agentManager.settings.project.empty")}</p>}
          >
            <SettingsRow
              title={language.t("agentManager.worktree.defaultBaseBranch")}
              description={language.t("agentManager.settings.defaultBaseBranch.description")}
            >
              <Button
                variant="secondary"
                size="small"
                title={branchLabel()}
                disabled={project()?.missing || branchLoading()}
                onClick={openBranches}
              >
                <span>{branchLabel()}</span>
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
                onClick={configureScript}
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

export default AgentManagerTab
