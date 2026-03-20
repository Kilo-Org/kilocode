import { Component, createSignal, createEffect, on, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Button } from "@kilocode/kilo-ui/button"
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
import TerminalTab from "./TerminalTab"
import PromptsTab from "./PromptsTab"
import ExperimentalTab from "./ExperimentalTab"
import LanguageTab from "./LanguageTab"
import AboutKiloCodeTab from "./AboutKiloCodeTab"
import { useServer } from "../../context/server"

export interface SettingsProps {
  tab?: string
  onTabChange?: (tab: string) => void
  onMigrateClick?: () => void // legacy-migration
}

const Settings: Component<SettingsProps> = (props) => {
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const { isDirty, saveConfig, discardConfig } = useConfig()
  const session = useSession()
  const [active, setActive] = createSignal(props.tab ?? "providers")

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

  // Sync when the parent changes the tab prop (e.g. via navigate message)
  createEffect(
    on(
      () => props.tab,
      (tab) => {
        if (tab) setActive(tab)
      },
    ),
  )

  const onTabChange = (tab: string) => {
    setActive(tab)
    props.onTabChange?.(tab)
    vscode.postMessage({ type: "settingsTabChanged", tab })
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": "1px solid var(--border-weak-base)",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}
      >
        <h2 style={{ "font-size": "16px", "font-weight": "600", margin: 0 }}>{language.t("sidebar.settings")}</h2>
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
          <Tabs.Trigger value="models">
            <Icon name="models" />
            <span class="label">{language.t("settings.models.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="providers">
            <Icon name="providers" />
            <span class="label">{language.t("settings.providers.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="agentBehaviour">
            <Icon name="brain" />
            <span class="label">{language.t("settings.agentBehaviour.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="autoApprove">
            <Icon name="checklist" />
            <span class="label">{language.t("settings.autoApprove.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="browser">
            <Icon name="window-cursor" />
            <span class="label">{language.t("settings.browser.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="checkpoints">
            <Icon name="branch" />
            <span class="label">{language.t("settings.checkpoints.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="display">
            <Icon name="eye" />
            <span class="label">{language.t("settings.display.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="autocomplete">
            <Icon name="code-lines" />
            <span class="label">{language.t("settings.autocomplete.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="notifications">
            <Icon name="circle-check" />
            <span class="label">{language.t("settings.notifications.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="context">
            <Icon name="server" />
            <span class="label">{language.t("settings.context.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="terminal">
            <Icon name="console" />
            <span class="label">{language.t("settings.terminal.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="prompts">
            <Icon name="comment" />
            <span class="label">{language.t("settings.prompts.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="experimental">
            <Icon name="settings-gear" />
            <span class="label">{language.t("settings.experimental.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="language">
            <Icon name="speech-bubble" />
            <span class="label">{language.t("settings.language.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="aboutKiloCode">
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
        <Tabs.Content value="browser">
          <h3>{language.t("settings.browser.title")}</h3>
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
          <AutocompleteTab />
        </Tabs.Content>
        <Tabs.Content value="notifications">
          <h3>{language.t("settings.notifications.title")}</h3>
          <NotificationsTab />
        </Tabs.Content>
        <Tabs.Content value="context">
          <h3>{language.t("settings.context.title")}</h3>
          <ContextTab />
        </Tabs.Content>
        <Tabs.Content value="terminal">
          <h3>{language.t("settings.terminal.title")}</h3>
          <TerminalTab />
        </Tabs.Content>
        <Tabs.Content value="prompts">
          <h3>{language.t("settings.prompts.title")}</h3>
          <PromptsTab />
        </Tabs.Content>
        <Tabs.Content value="experimental">
          <h3>{language.t("settings.experimental.title")}</h3>
          <ExperimentalTab />
        </Tabs.Content>
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
            onMigrateClick={props.onMigrateClick}
          />
        </Tabs.Content>
      </Tabs>

      {/* Save bar — visible when there are unsaved config changes */}
      <Show when={isDirty()}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "flex-end",
            gap: "8px",
            padding: "8px 16px",
            "border-top": "1px solid var(--border-weak-base)",
          }}
        >
          <span style={{ "font-size": "12px", color: "var(--foreground-secondary)", "margin-right": "auto" }}>
            {language.t("settings.saveBar.unsavedChanges")}
          </span>
          <Button variant="ghost" size="small" onClick={discardConfig}>
            {language.t("settings.saveBar.discard")}
          </Button>
          <Button variant="primary" size="small" onClick={handleSave}>
            {language.t("settings.saveBar.save")}
          </Button>
        </div>
      </Show>
    </div>
  )
}

export default Settings
