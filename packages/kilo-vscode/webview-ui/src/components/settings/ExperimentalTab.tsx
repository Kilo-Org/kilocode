// Experimental tab on v2 config. Only the rows with a v2 key are rendered: Share Mode (`share`), Formatter
// (`formatter`), LSP (`lsp`) and Image Generation (`experimental.image_generate`). The other rows have no v2 key and
// are not rendered. The image model row only shows while image generation is on, because writing a model also turns
// the tool on.
import { Component, Show } from "solid-js"
import { Switch } from "./Switch"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { KiloImageModelsProvider, useKiloImageModels } from "../../context/kilo-image-models"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import ModelPicker from "./ModelPicker"
import { selection, write, type ModelSelection } from "./models-selection"
import SettingsRow from "./SettingsRow"
import { imageGenerationEnabled, imageGenerationModel, imageGenerationSwitch, keepRecord } from "./settings-values"

interface ShareOption {
  value: string
  labelKey: string
}

const SHARE_OPTIONS: ShareOption[] = [
  { value: "manual", labelKey: "settings.experimental.share.manual" },
  { value: "auto", labelKey: "settings.experimental.share.auto" },
  { value: "disabled", labelKey: "settings.experimental.share.disabled" },
]

const ExperimentalTabContent: Component = () => {
  const language = useLanguage()
  const config = useSettingsConfig()
  const imageModels = useKiloImageModels()

  const imageGenerate = () => config.value(["experimental", "image_generate"])
  const imageModel = () => selection(config.value(["experimental", "image_generate", "model"]))
  const setImageModel = (value: ModelSelection | undefined) =>
    config.set(["experimental", "image_generate"], imageGenerationModel(imageGenerate(), write(value)))

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
        >
          <Switch
            checked={config.value(["lsp"]) !== false}
            onChange={(checked) => config.set(["lsp"], keepRecord(config.value(["lsp"]), checked))}
            hideLabel
          >
            {language.t("settings.experimental.lsp.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.imageGeneration.title")}
          description={language.t("settings.experimental.imageGeneration.description")}
        >
          <Switch
            checked={imageGenerationEnabled(imageGenerate())}
            onChange={(checked) =>
              config.set(["experimental", "image_generate"], imageGenerationSwitch(imageGenerate(), checked))
            }
            hideLabel
          >
            {language.t("settings.experimental.imageGeneration.title")}
          </Switch>
        </SettingsRow>

        <Show when={imageGenerationEnabled(imageGenerate())}>
          <SettingsRow
            title={language.t("settings.experimental.imageGenerationModel.title")}
            description={language.t("settings.experimental.imageGenerationModel.description")}
          >
            <ModelPicker
              models={imageModels.models}
              value={imageModel()}
              onChange={setImageModel}
              clearable
              clearLabel={language.t("settings.experimental.imageGenerationModel.placeholder")}
            />
          </SettingsRow>
        </Show>

        <SettingsRow
          title={language.t("settings.experimental.conversationPromptHistory.title")}
          description={language.t("settings.experimental.conversationPromptHistory.description")}
        >
          <Switch
            checked={config.setting("experimental.conversationPromptHistory") === true}
            onChange={(checked) => config.setSetting("experimental.conversationPromptHistory", checked)}
            hideLabel
          >
            {language.t("settings.experimental.conversationPromptHistory.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.nativeNotebookTools.title")}
          description={language.t("settings.experimental.nativeNotebookTools.description")}
          last
        >
          <Switch
            checked={config.setting("experimental.nativeNotebookTools") === true}
            onChange={(checked) => config.setSetting("experimental.nativeNotebookTools", checked)}
            hideLabel
          >
            {language.t("settings.experimental.nativeNotebookTools.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

// Only this tab reads the image model catalog, so the Settings shell does not mount it.
export default function ExperimentalTab() {
  return (
    <KiloImageModelsProvider>
      <ExperimentalTabContent />
    </KiloImageModelsProvider>
  )
}
