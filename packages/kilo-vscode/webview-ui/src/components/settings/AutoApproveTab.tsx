import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createSignal, type Component } from "solid-js"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import PermissionEditor from "./PermissionEditor"
import SettingsRow from "./SettingsRow"

const AutoApproveTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()
  const [draft, setDraft] = createSignal<string>()
  const saved = () => {
    const value = config.setting("maxCost")
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
  }
  const value = () => draft() ?? (saved() ? String(saved()) : "")
  const commit = () => {
    const next = Number(value())
    setDraft(undefined)
    if (!Number.isFinite(next) || next < 0 || next === saved()) return
    config.setSetting("maxCost", next)
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.autoApprove.maxCost.title")}
          description={language.t("settings.autoApprove.maxCost.v2Description")}
          last
        >
          <div style={{ width: "160px" }}>
            <TextField
              type="text"
              inputMode="decimal"
              value={value()}
              placeholder="5"
              label={language.t("settings.autoApprove.maxCost.title")}
              hideLabel
              onChange={setDraft}
              onBlur={commit}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                commit()
              }}
            />
          </div>
        </SettingsRow>
      </Card>
      <div style={{ "margin-top": "16px" }}>
        <PermissionEditor target={{ kind: "root" }} />
      </div>
    </div>
  )
}

export default AutoApproveTab
