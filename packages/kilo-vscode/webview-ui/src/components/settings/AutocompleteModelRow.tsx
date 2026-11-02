// The autocomplete model row of the Models tab. The catalog is the fixed autocomplete list, not the chat catalog; a
// choice writes `kilo-code.v2.autocomplete.provider` and `.model`, and the clear control unsets both so the default
// applies again.
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Show, type Component } from "solid-js"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import { ModelSelectorBase } from "../shared/ModelSelector"
import { AUTOCOMPLETE_SELECTOR_MODELS, getAutocompleteSelection } from "./autocomplete-model-selector"
import SettingsRow from "./SettingsRow"

// SAFETY: ModelSelectorBase reads only id, providerID, name, cost, enabled and status of a model, and id and name of
// a provider; the autocomplete catalog has no other chat model fields.
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
const MODELS = AUTOCOMPLETE_SELECTOR_MODELS.map((model) => ({
  id: model.id,
  providerID: model.providerID,
  name: model.name,
  cost: [],
  enabled: true,
  status: "active",
})) as unknown as ModelInfo[]
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
const PROVIDERS = [...new Map(AUTOCOMPLETE_SELECTOR_MODELS.map((model) => [model.providerID, model.providerName]))].map(
  ([id, name]) => ({ id, name }),
) as unknown as ProviderInfo[]

const AutocompleteModelRow: Component = () => {
  const language = useLanguage()
  const config = useSettingsConfig()
  const text = (key: "autocomplete.provider" | "autocomplete.model") => {
    const value = config.setting(key)
    return typeof value === "string" ? value : undefined
  }
  const value = () => getAutocompleteSelection(text("autocomplete.provider"), text("autocomplete.model"))
  const select = (providerID?: string, modelID?: string) => {
    config.setSetting("autocomplete.provider", providerID && modelID ? providerID : null)
    config.setSetting("autocomplete.model", providerID && modelID ? modelID : null)
  }

  return (
    <SettingsRow
      title={language.t("settings.autocomplete.model.title")}
      description={language.t("settings.autocomplete.model.description")}
    >
      <div data-component="autocomplete-model" style={{ display: "flex", gap: "8px", "align-items": "center" }}>
        <ModelSelectorBase
          models={MODELS}
          providers={PROVIDERS}
          value={value()}
          placeholder={language.t("settings.providers.notSet")}
          label={language.t("settings.autocomplete.model.title")}
          onSelect={(providerID, modelID) => select(providerID, modelID)}
        />
        <Show when={value()}>
          <IconButton
            size="small"
            variant="ghost"
            icon="close"
            aria-label={language.t("settings.providers.notSet")}
            onClick={() => select()}
          />
        </Show>
      </div>
    </SettingsRow>
  )
}

export default AutocompleteModelRow
