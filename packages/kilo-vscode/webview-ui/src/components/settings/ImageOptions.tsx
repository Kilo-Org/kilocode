import { For, createEffect, createSignal, on } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Select } from "@kilocode/kilo-ui/select"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

export default function ImageOptions() {
  const settings = useConfig()
  const language = useLanguage()
  const options = () => settings.config().experimental?.image_generation_options ?? {}
  const [draft, setDraft] = createSignal<Partial<Record<"size" | "seed" | "steps", string>>>({})
  const backgrounds = ["default", "auto", "opaque", "transparent"] as const
  const update = (key: string, value: unknown) =>
    settings.updateConfig({
      experimental: { image_generation_options: { [key]: value } },
    })
  const change = (key: "size" | "seed" | "steps", value: string) => {
    const text = value.trim()
    const valid =
      !text ||
      (key === "size"
        ? /^(auto|[1-9]\d*x[1-9]\d*)$/.test(text)
        : Number.isSafeInteger(Number(text)) && Number(text) >= (key === "seed" ? 0 : 1))
    setDraft((prev) => ({ ...prev, [key]: valid ? undefined : value }))
    if (valid) update(key, text ? (key === "size" ? text : Number(text)) : null)
  }

  createEffect(
    on(settings.isDirty, (dirty) => {
      if (!dirty) setDraft({})
    }),
  )

  return (
    <>
      <SettingsRow
        title={language.t("settings.experimental.imageGenerationOptions.size.title")}
        description={language.t("settings.experimental.imageGenerationOptions.size.description")}
      >
        <TextField
          value={draft().size ?? options().size ?? ""}
          placeholder="auto"
          aria-label={language.t("settings.experimental.imageGenerationOptions.size.title")}
          validationState={draft().size == null ? "valid" : "invalid"}
          error={language.t("settings.experimental.imageGenerationOptions.size.error")}
          onChange={(value) => change("size", value)}
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
              value={draft()[field.key] ?? options()[field.key]?.toString() ?? ""}
              placeholder={language.t("settings.experimental.imageGenerationOptions.default")}
              validationState={draft()[field.key] == null ? "valid" : "invalid"}
              error={language.t("settings.experimental.imageGenerationOptions.number.error", {
                min: field.min,
                max: Number.MAX_SAFE_INTEGER,
              })}
              onChange={(value) => change(field.key, value)}
            />
          </SettingsRow>
        )}
      </For>
    </>
  )
}
