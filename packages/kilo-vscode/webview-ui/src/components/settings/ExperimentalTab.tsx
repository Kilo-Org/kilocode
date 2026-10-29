// Experimental tab on v2 config. Only the rows with a v2 key are rendered: Share Mode (`share`), Formatter
// (`formatter`) and LSP (`lsp`). The other rows have no v2 key and are not rendered.
import { Component } from "solid-js"
import { Switch } from "./Switch"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import { keepRecord } from "./settings-values"

interface ShareOption {
  value: string
  labelKey: string
}

const SHARE_OPTIONS: ShareOption[] = [
  { value: "manual", labelKey: "settings.experimental.share.manual" },
  { value: "auto", labelKey: "settings.experimental.share.auto" },
  { value: "disabled", labelKey: "settings.experimental.share.disabled" },
]

const ExperimentalTab: Component = () => {
  const language = useLanguage()
  const config = useSettingsConfig()

  return (
    <div>
      <Card>
        {/* Share mode */}
        <SettingsRow
          title={language.t("settings.experimental.share.title")}
          description={language.t("settings.experimental.share.description")}
        >
          <Select
            options={SHARE_OPTIONS}
            current={SHARE_OPTIONS.find((o) => o.value === (config.value(["share"]) ?? "manual"))}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as "manual" | "auto" | "disabled"
              if (next === (config.value(["share"]) ?? "manual")) return
              config.set(["share"], next)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.formatter.title")}
          description={language.t("settings.experimental.formatter.description")}
        >
          <Switch
            checked={config.value(["formatter"]) !== false}
            onChange={(checked) => config.set(["formatter"], keepRecord(config.value(["formatter"]), checked))}
            hideLabel
          >
            {language.t("settings.experimental.formatter.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.lsp.title")}
          description={language.t("settings.experimental.lsp.description")}
          last
        >
          <Switch
            checked={config.value(["lsp"]) !== false}
            onChange={(checked) => config.set(["lsp"], keepRecord(config.value(["lsp"]), checked))}
            hideLabel
          >
            {language.t("settings.experimental.lsp.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default ExperimentalTab
