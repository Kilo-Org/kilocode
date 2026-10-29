import { For } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Select } from "@kilocode/kilo-ui/select"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

export default function ImageOptions() {
  const settings = useConfig()
  const language = useLanguage()
  const options = () => settings.config().experimental?.image_generation_options ?? {}
  const backgrounds = ["default", "auto", "opaque", "transparent"] as const
  const update = (key: string, value: unknown) =>
    settings.updateConfig({
      experimental: { image_generation_options: { [key]: value } },
    })

  return (
    <>
      <SettingsRow
        title={language.t("settings.experimental.imageGenerationOptions.size.title")}
        description={language.t("settings.experimental.imageGenerationOptions.size.description")}
      >
        <TextField
          value={options().size ?? ""}
          placeholder="auto"
          aria-label={language.t("settings.experimental.imageGenerationOptions.size.title")}
          onChange={(value) => update("size", value.trim() || null)}
        />
      </SettingsRow>
      <SettingsRow
        title={language.t("settings.experimental.imageGenerationOptions.background.title")}
        description={language.t("settings.experimental.imageGenerationOptions.background.description")}
      >
        <Select
          options={[...backgrounds]}
          current={options().background ?? "default"}
          value={(value) => value}
          label={(value) => language.t(`settings.experimental.imageGenerationOptions.${value}`)}
          onSelect={(value) => update("background", value === "default" ? null : value)}
          triggerProps={{ "aria-label": language.t("settings.experimental.imageGenerationOptions.background.title") }}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </SettingsRow>
      <For
        each={
          [
            { key: "seed", min: 0 },
            { key: "steps", min: 1 },
          ] as const
        }
      >
        {(field) => (
          <SettingsRow
            title={language.t(`settings.experimental.imageGenerationOptions.${field.key}.title`)}
            description={language.t(`settings.experimental.imageGenerationOptions.${field.key}.description`)}
          >
            <TextField
              type="number"
              min={field.min}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              aria-label={language.t(`settings.experimental.imageGenerationOptions.${field.key}.title`)}
              value={options()[field.key]?.toString() ?? ""}
              placeholder={language.t("settings.experimental.imageGenerationOptions.default")}
              onChange={(value) => update(field.key, value.trim() ? Number(value) : null)}
            />
          </SettingsRow>
        )}
      </For>
    </>
  )
}
