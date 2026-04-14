import { Component } from "solid-js"
import { Card } from "@devilcode/kilo-ui/card"
import { Select } from "@devilcode/kilo-ui/select"
import { Switch } from "@devilcode/kilo-ui/switch"
import type { TeamConfig, TeamRoutingConfig } from "../../types/messages"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

interface TeamRoutingPanelProps {
  team: TeamConfig
  onChange: (routing: TeamRoutingConfig) => void
}

const TeamRoutingPanel: Component<TeamRoutingPanelProps> = (props) => {
  const language = useLanguage()

  const roleOptions = () =>
    Object.keys(props.team.roles).map((roleID) => ({
      value: roleID,
      label: props.team.roles[roleID]?.displayName || roleID,
    }))

  const strategyOptions = () => [
    { value: "hierarchical", label: language.t("settings.team.routing.strategy.hierarchical") },
    { value: "flat", label: language.t("settings.team.routing.strategy.flat") },
  ]

  return (
    <Card>
      <SettingsRow
        title={language.t("settings.team.routing.strategy")}
        description={language.t("settings.team.routing.strategy.description")}
      >
        <Select
          options={strategyOptions()}
          current={strategyOptions().find((option) => option.value === props.team.routing.strategy)}
          value={(option) => option.value}
          label={(option) => option.label}
          onSelect={(option) => {
            if (!option) return
            props.onChange({
              ...props.team.routing,
              strategy: option.value as TeamRoutingConfig["strategy"],
            })
          }}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow title={language.t("settings.team.routing.defaultRole")} last={false}>
        <Select
          options={roleOptions()}
          current={roleOptions().find((option) => option.value === props.team.routing.defaultRole)}
          value={(option) => option.value}
          label={(option) => option.label}
          onSelect={(option) => {
            if (!option) return
            props.onChange({
              ...props.team.routing,
              defaultRole: option.value,
            })
          }}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.team.routing.escalation")}
        description={language.t("settings.team.routing.escalation.description")}
        last
      >
        <Switch
          checked={props.team.routing.escalationEnabled}
          onChange={(enabled: boolean) => {
            props.onChange({
              ...props.team.routing,
              escalationEnabled: enabled,
            })
          }}
          hideLabel
        >
          {language.t("settings.team.routing.escalation")}
        </Switch>
      </SettingsRow>
    </Card>
  )
}

export default TeamRoutingPanel
