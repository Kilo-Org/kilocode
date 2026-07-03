import { Component, createMemo } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import PermissionEditor from "./PermissionEditor"
import SettingsRow from "./SettingsRow"

const AutoApproveTab: Component = () => {
  const { config, settings, updateConfig, updateSetting } = useConfig()
  const language = useLanguage()

  const permissions = createMemo(() => config().permission ?? {})
  const cost = createMemo(() => {
    const value = settings().maxCost
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0
  })

  const updateCost = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      updateSetting("maxCost", 0)
      return
    }
    if (!/^\d+$/.test(trimmed)) return
    const next = Number(trimmed)
    if (Number.isFinite(next) && next >= 0) updateSetting("maxCost", next)
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.autoApprove.maxCost.title")}
          description={language.t("settings.autoApprove.maxCost.description")}
          last
        >
          <TextField
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={cost() ? String(cost()) : ""}
            placeholder="5"
            onChange={updateCost}
            hideLabel
            label={language.t("settings.autoApprove.maxCost.title")}
          />
        </SettingsRow>
      </Card>

      <div style={{ height: "12px" }} />

      <PermissionEditor
        permissions={permissions()}
        description={language.t("settings.autoApprove.description")}
        onChange={(patch) => updateConfig({ permission: patch })}
      />
    </div>
  )
}

export default AutoApproveTab
