// The Models tab on the v2 config. The top-level `model`, the `title` and `compaction` agent models, one model per
// selectable agent under `agents.<id>.model`, the speech-to-text source, and the top-level Kilo
// `hide_prompt_training_models` policy key.
import { Card } from "@kilocode/kilo-ui/card"
import { Component, For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../../context/language"
import { useV2 } from "../../v2/client"
import { useSettingsConfig } from "../../v2/settings-config"
import { useSpeechStatus } from "../speech-to-text/status"
import { speechToTextModelOptions } from "../speech-to-text/model-selector"
import { selectedSpeechToTextModel } from "../speech-to-text/availability"
import { DEFAULT_SPEECH_TO_TEXT_MODEL } from "../../../../src/speech-to-text/models"
import AutocompleteModelRow from "./AutocompleteModelRow"
import ModelPicker from "./ModelPicker"
import { selection, write, preserveVariant, readPathValue, type ModelSelection } from "./models-selection"
import SettingsRow from "./SettingsRow"
import { Switch } from "./Switch"
import type { SettingsTabProps } from "./tabs"

const ModelsTab: Component<SettingsTabProps> = () => {
  const language = useLanguage()
  const v2 = useV2()
  const config = useSettingsConfig()
  const speech = useSpeechStatus()
  // The host reads and writes the machine-wide file, so Settings and the composer resolve the same source even when
  // the config API cannot carry the Kilo-only keys. A project overlay cannot enable voice input.
  const speechText = (key: "base_url" | "api_key" | "model") => {
    const settings = speech.status().settings
    const value = key === "base_url" ? settings.baseUrl : key === "api_key" ? settings.apiKey : settings.model
    return value ?? ""
  }
  const customSpeech = () => !!speechText("base_url")
  const speechModels = () => speech.status().models
  const speechOptions = createMemo(() => speechToTextModelOptions(speechModels()))
  const speechModel = () =>
    selectedSpeechToTextModel(
      {
        experimental: {
          speech_to_text_base_url: speechText("base_url"),
          speech_to_text_model: speechText("model"),
        },
      },
      speechModels(),
    )
  const speechOption = createMemo(() => speechOptions().find((item) => item.value === speechModel()))
  const updateSpeech = (key: "base_url" | "api_key" | "model", value: string) => {
    speech.save(key, value).catch((error: unknown) => {
      showToast({
        variant: "error",
        title: language.t("settings.saveBar.saveFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }
  const speechField = (key: "base_url" | "api_key" | "model", placeholder: string, type?: string) => (
    <SpeechTextField
      value={speechText(key)}
      placeholder={placeholder}
      type={type}
      disabled={key === "api_key" && !customSpeech()}
      onCommit={(value) => updateSpeech(key, value)}
    />
  )
  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected") return
      void Promise.all([
        v2.data.location.agent.sync(),
        v2.data.location.model.sync(),
        v2.data.location.provider.sync(),
      ]).catch(v2.report)
    }),
  )

  const agents = createMemo(() =>
    (v2.data.location.agent.list() ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden),
  )

  const notSet = () => language.t("settings.providers.notSet")

  // A row reads as set only when a config file sets the key (or a write is in flight). The file value is preferred
  // over the merged value so a resolved config default does not replace what the user set; the merged value is the
  // fallback for a key that a legacy alias stores. While a write is in flight the raw snapshot is stale, so the
  // optimistic value from `config.value` is used instead.
  const current = (path: string[]) => {
    const scope = config.source(path)
    const pending = config.pending(path)
    if (!scope && !pending) return undefined
    const raw = scope && !pending ? readPathValue(config.raw(scope), path) : undefined
    return selection(raw ?? config.value(path))
  }
  const change = (path: string[]) => (value: ModelSelection | undefined) => {
    // Write the scope that already defines the key so a project override is updated in place, not shadowed.
    const scope = config.source(path) ?? "global"
    if (!value) return config.unset(path, scope)
    // This tab hides the variant control, so keep an existing variant when the model itself is unchanged.
    return config.set(path, write(preserveVariant(selection(config.value(path)), value)), scope)
  }

  // The effective value comes from the host, which reads every config document because the config API cannot carry
  // this Kilo-only field. A value the config layer has (an optimistic write) wins, and the raw files are the fallback
  // when the host could not read the policy.
  const hidden = () => {
    const value = config.value(["hide_prompt_training_models"])
    if (typeof value === "boolean") return value
    const policy = config.policy()
    if (policy) return policy.hidePromptTrainingModels
    const project = config.raw("project")?.hide_prompt_training_models
    if (typeof project === "boolean") return project
    return config.raw("global")?.hide_prompt_training_models === true
  }
  // A managed document outside the writable global and project files sets the value, so the switch does not edit it.
  const hiddenLocked = () => config.policy()?.managed === true
  const setHidden = (checked: boolean) => config.set(["hide_prompt_training_models"], checked)

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.providers.defaultModel.title")}
          description={language.t("settings.providers.defaultModel.description")}
        >
          <ModelPicker
            value={current(["model"])}
            onChange={change(["model"])}
            clearable
            clearLabel={notSet()}
            showVariants={false}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.providers.smallModel.title")}
          description={language.t("settings.providers.smallModel.description")}
        >
          <ModelPicker
            value={current(["agents", "title", "model"])}
            onChange={change(["agents", "title", "model"])}
            clearable
            clearLabel={notSet()}
            showVariants={false}
            includeAutoSmall
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.compactionModel.title")}
          description={language.t("settings.context.compactionModel.description")}
        >
          <ModelPicker
            value={current(["agents", "compaction", "model"])}
            onChange={change(["agents", "compaction", "model"])}
            clearable
            clearLabel={language.t("settings.context.compactionModel.useChatModel")}
            showVariants={false}
          />
        </SettingsRow>
        <AutocompleteModelRow />
        <SettingsRow
          title={language.t("settings.models.speechToTextBaseUrl.title")}
          description={language.t("settings.models.speechToTextBaseUrl.description")}
        >
          {speechField("base_url", language.t("settings.models.speechToTextBaseUrl.placeholder"))}
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.models.speechToTextApiKey.title")}
          description={language.t("settings.models.speechToTextApiKey.description")}
        >
          {speechField("api_key", language.t("settings.models.speechToTextApiKey.placeholder"), "password")}
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.models.speechToTextModel.title")}
          description={
            speech.status().remote
              ? language.t("settings.models.speechToText.remoteDescription")
              : customSpeech()
                ? language.t("settings.models.speechToTextModel.customDescription")
                : speech.status().signedIn
                  ? language.t("settings.models.speechToTextModel.description")
                  : language.t("settings.models.speechToText.disabledDescription")
          }
        >
          <Show
            when={!customSpeech()}
            fallback={speechField("model", language.t("settings.models.speechToTextModel.customPlaceholder"))}
          >
            <Tooltip
              value={language.t("settings.models.speechToText.disabledDescription")}
              placement="top"
              inactive={speech.status().signedIn}
            >
              <Select
                options={speechOptions()}
                current={speechOption()}
                value={(item) => item.value}
                label={(item) => `${item.label} (${item.provider})`}
                onSelect={(item) => updateSpeech("model", item?.value ?? DEFAULT_SPEECH_TO_TEXT_MODEL.id)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerProps={{
                  "aria-label": `${language.t("settings.models.speechToTextModel.title")}: ${speechOption()?.label}`,
                }}
                disabled={!speech.status().signedIn}
                placeholder={DEFAULT_SPEECH_TO_TEXT_MODEL.label}
              />
            </Tooltip>
          </Show>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.models.hidePromptTraining.title")}
          description={
            hiddenLocked()
              ? language.t("settings.models.hidePromptTraining.managed")
              : language.t("settings.models.hidePromptTraining.description")
          }
          last
        >
          <Switch checked={hidden()} onChange={setHidden} disabled={hiddenLocked()} hideLabel>
            {language.t("settings.models.hidePromptTraining.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "24px", "margin-bottom": "8px" }}>{language.t("settings.providers.modeModels")}</h4>
      <Card>
        <For each={agents()}>
          {(agent, index) => (
            <SettingsRow title={agent.name.charAt(0).toUpperCase() + agent.name.slice(1)} last={index() === agents().length - 1}>
              <ModelPicker
                value={current(["agents", agent.id, "model"])}
                onChange={change(["agents", agent.id, "model"])}
                clearable
                clearLabel={notSet()}
                showVariants={false}
              />
            </SettingsRow>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ModelsTab

/** Commit on blur or Enter, not on every keystroke: a keystroke would otherwise write and reload the config. */
const SpeechTextField: Component<{
  value: string
  placeholder: string
  type?: string
  disabled?: boolean
  onCommit: (value: string) => void
}> = (props) => {
  const [draft, setDraft] = createSignal(props.value)
  const [focused, setFocused] = createSignal(false)
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!focused()) setDraft(value)
      },
      { defer: true },
    ),
  )
  const commit = () => {
    if (draft() === props.value) return
    props.onCommit(draft())
  }
  return (
    <TextField
      type={props.type}
      value={draft()}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onChange={(value: string) => setDraft(value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Enter") return
        event.preventDefault()
        commit()
      }}
    />
  )
}
