import { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../context/language"
import ProvidersTab from "./settings/ProvidersTab"
import AgentBehaviourTab from "./settings/AgentBehaviourTab"
import AutoApproveTab from "./settings/AutoApproveTab"
import BrowserTab from "./settings/BrowserTab"
import CheckpointsTab from "./settings/CheckpointsTab"
import DisplayTab from "./settings/DisplayTab"
import AutocompleteTab from "./settings/AutocompleteTab"
import NotificationsTab from "./settings/NotificationsTab"
import ContextTab from "./settings/ContextTab"
import TerminalTab from "./settings/TerminalTab"
import PromptsTab from "./settings/PromptsTab"
import ExperimentalTab from "./settings/ExperimentalTab"
import LanguageTab from "./settings/LanguageTab"
import AboutKiloCodeTab from "./settings/AboutKiloCodeTab"
import { useServer } from "../context/server"

export interface SettingsProps {
  onBack?: () => void
}

const Settings: Component<SettingsProps> = (props) => {
  const server = useServer()
  const language = useLanguage()

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
        <Tooltip value={language.t("common.goBack")} placement="bottom">
          <Button variant="ghost" size="small" onClick={() => props.onBack?.()}>
            <Icon name="arrow-left" />
          </Button>
        </Tooltip>
        <h2 style={{ "font-size": "16px", "font-weight": "600", margin: 0 }}>{language.t("sidebar.settings")}</h2>
      </div>

      {/* Settings tabs */}
      <Tabs orientation="vertical" variant="settings" defaultValue="providers" style={{ flex: 1, overflow: "hidden" }}>
        <Tabs.List>
          <Tabs.SectionTitle>{language.t("settings.section.configuration")}</Tabs.SectionTitle>
          <Tabs.Trigger value="providers">
            <Icon name="providers" />
            {language.t("settings.providers.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="agentBehaviour">
            <Icon name="brain" />
            {language.t("settings.agentBehaviour.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="autoApprove">
            <Icon name="checklist" />
            {language.t("settings.autoApprove.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="browser">
            <Icon name="window-cursor" />
            {language.t("settings.browser.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="checkpoints">
            <Icon name="branch" />
            {language.t("settings.checkpoints.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="display">
            <Icon name="eye" />
            {language.t("settings.display.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="autocomplete">
            <Icon name="code-lines" />
            {language.t("settings.autocomplete.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="notifications">
            <Icon name="circle-check" />
            {language.t("settings.notifications.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="context">
            <Icon name="server" />
            {language.t("settings.context.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="terminal">
            <Icon name="console" />
            {language.t("settings.terminal.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="prompts">
            <Icon name="comment" />
            {language.t("settings.prompts.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="experimental">
            <Icon name="settings-gear" />
            {language.t("settings.experimental.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="language">
            <Icon name="speech-bubble" />
            {language.t("settings.language.title")}
          </Tabs.Trigger>
          <Tabs.Trigger value="aboutKiloCode">
            <Icon name="help" />
            {language.t("settings.aboutKiloCode.title")}
          </Tabs.Trigger>
        </Tabs.List>

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
          <AboutKiloCodeTab port={server.serverInfo()?.port ?? null} connectionState={server.connectionState()} />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

export default Settings
