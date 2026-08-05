import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Show } from "solid-js"
import type { ReasoningEffort, ReasoningOption } from "../../../../src/shared/custom-provider"
import { useLanguage } from "../../context/language"
import { ReasoningEfforts } from "./CustomProviderReasoning"

export type Translator = ReturnType<typeof useLanguage>["t"]
export type Modality = "text" | "audio" | "image" | "video" | "pdf"
export type ReasoningMode = "inherit" | "custom" | "none"

export type Modalities = {
  input?: Modality[]
  output?: Modality[]
}

export type ModelEntry = {
  id: string
  name: string
  reasoning: boolean
  supportsImages: boolean
  modalities: Modalities
  mode: ReasoningMode
  efforts: ReasoningEffort[]
  metadata?: ReasoningOption[]
  variants?: Record<string, Record<string, unknown>>
}

const MODES: Array<{ value: ReasoningMode; label: string }> = [
  { value: "inherit", label: "provider.custom.reasoning.mode.inherit" },
  { value: "custom", label: "provider.custom.reasoning.mode.custom" },
  { value: "none", label: "provider.custom.reasoning.mode.none" },
]

type Props = {
  m: ModelEntry
  errors: { id?: string; name?: string }
  defaults: readonly ReasoningEffort[]
  defaultMetadata?: ReasoningOption[]
  advanced: boolean
  t: Translator
  canRemove: boolean
  onChangeId: (value: string) => void
  onChangeName: (value: string) => void
  onChangeReasoning: (value: boolean) => void
  onChangeSupportsImages: (value: boolean) => void
  onChangeMode: (value: ReasoningMode) => void
  onChangeEfforts: (values: ReasoningEffort[]) => void
  onRemove: () => void
}

export function ModelCard(props: Props) {
  const inherited = () =>
    props.defaults.length > 0
      ? props.t("provider.custom.reasoning.mode.inherit.description", { efforts: props.defaults.join(", ") })
      : props.defaultMetadata?.length === 0
        ? props.t("provider.custom.reasoning.mode.inherit.none")
        : props.defaultMetadata !== undefined
          ? props.t("provider.custom.reasoning.mode.inherit.advanced")
          : props.t("provider.custom.reasoning.mode.inherit.automatic")

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
        padding: "12px",
        border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
        "border-radius": "6px",
      }}
    >
      <div style={{ display: "flex", gap: "8px", "align-items": "flex-end" }}>
        <div style={{ flex: 1 }}>
          <TextField
            label={props.t("provider.custom.models.id.label")}
            placeholder={props.t("provider.custom.models.id.placeholder")}
            value={props.m.id}
            onChange={props.onChangeId}
            validationState={props.errors.id ? "invalid" : undefined}
            error={props.errors.id}
          />
        </div>
        <div style={{ flex: 1 }}>
          <TextField
            label={props.t("provider.custom.models.name.label")}
            placeholder={props.t("provider.custom.models.name.placeholder")}
            value={props.m.name}
            onChange={props.onChangeName}
            validationState={props.errors.name ? "invalid" : undefined}
            error={props.errors.name}
          />
        </div>
        <IconButton
          type="button"
          icon="trash"
          variant="ghost"
          onClick={props.onRemove}
          disabled={!props.canRemove}
          aria-label={props.t("provider.custom.models.remove")}
          style={{ "margin-bottom": "4px" }}
        />
      </div>

      <div style={{ display: "flex", gap: "20px", "flex-wrap": "wrap" }}>
        <Checkbox checked={props.m.reasoning} onChange={props.onChangeReasoning}>
          {props.t("provider.custom.models.reasoning.label")}
        </Checkbox>
        <Checkbox checked={props.m.supportsImages} onChange={props.onChangeSupportsImages}>
          {props.t("provider.custom.models.modalities.image")}
        </Checkbox>
      </div>

      <Show when={props.m.reasoning}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <label
            style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
          >
            {props.t("provider.custom.reasoning.model.label")}
          </label>
          <Select
            options={MODES}
            current={MODES.find((mode) => mode.value === props.m.mode)}
            value={(mode) => mode.value}
            label={(mode) => props.t(mode.label)}
            onSelect={(mode) => mode && props.onChangeMode(mode.value)}
            aria-label={props.t("provider.custom.reasoning.model.label")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
          <Show when={props.m.mode === "inherit"}>
            <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--text-weak-base)" }}>
              {inherited()}
            </span>
          </Show>
          <Show when={props.m.mode === "custom"}>
            <ReasoningEfforts
              values={props.m.efforts}
              onChange={props.onChangeEfforts}
              t={props.t}
              label={props.t("provider.custom.reasoning.model.efforts")}
            />
          </Show>
        </div>
      </Show>
      <Show when={props.m.reasoning && props.advanced}>
        <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--text-weak-base)" }}>
          {props.t("provider.custom.reasoning.advanced")}
        </span>
      </Show>
      <Show when={props.m.variants && Object.keys(props.m.variants).length > 0}>
        <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--text-weak-base)" }}>
          {props.t("provider.custom.reasoning.legacy")}
        </span>
      </Show>
    </div>
  )
}
