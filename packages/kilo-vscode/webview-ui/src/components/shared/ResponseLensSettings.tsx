import { type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { responseLensLevels, responseLensSettings } from "../../../../src/shared/response-lens"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { ModelSelectorBase } from "./ModelSelector"

export const ResponseLensSettings: Component = () => {
  const config = useConfig()
  const language = useLanguage()
  const settings = () => responseLensSettings(config.settings()["chat.responseLens"])
  const update = (value: ReturnType<typeof settings>) => config.applySetting("chat.responseLens", value)
  return (
    <div class="response-lens-settings" data-component="response-lens-settings">
      <Switch checked={settings().enabled} onChange={(enabled) => update({ ...settings(), enabled })}>
        {language.t("responseLens.enabled")}
      </Switch>
      <Select
        options={[...responseLensLevels]}
        current={settings().level}
        value={(level) => level}
        label={(level) => language.t(`responseLens.level.${level}`)}
        placeholder={language.t("responseLens.level")}
        onSelect={(level) => level && update({ ...settings(), level })}
        size="small"
        variant="secondary"
        triggerProps={{ "aria-label": language.t("responseLens.level") }}
      />
      <div class="response-lens-model">
        <ModelSelectorBase
          value={settings().model ?? null}
          onSelect={(providerID, modelID) =>
            update({ ...settings(), model: providerID && modelID ? { providerID, modelID } : undefined })
          }
          allowClear
          clearLabel={language.t("responseLens.activeModel")}
          label={language.t("responseLens.model")}
          portal={false}
          trigger="response-lens"
        />
      </div>
      <Button variant="ghost" size="small" onClick={() => update({ enabled: true, level: "simple" })}>
        {language.t("responseLens.reset")}
      </Button>
    </div>
  )
}
