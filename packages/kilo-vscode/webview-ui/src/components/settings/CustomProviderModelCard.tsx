import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Show } from "solid-js"
import { useLanguage } from "../../context/language"

export type Translator = ReturnType<typeof useLanguage>["t"]

// undefined = not set; true/false = enable_thinking value
export type EnableThinkingValue = undefined | boolean
export type ThinkingTypeValue = undefined | "enabled" | "disabled" | "adaptive"
export type SplitReasoningValue = undefined | boolean
export type ReasoningEffortValue = undefined | "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
export type OutputEffortValue = undefined | "low" | "medium" | "high" | "xhigh" | "max"
export type ChatTemplateArgsValue = undefined | boolean
export type Modality = "text" | "audio" | "image" | "video" | "pdf"

export type Modalities = {
  input?: Modality[]
  output?: Modality[]
}

export type VariantEntry = {
  name: string
  raw?: Record<string, unknown>
  enableThinking: EnableThinkingValue
  thinking: ThinkingTypeValue
  splitReasoning: SplitReasoningValue
  reasoningEffort: ReasoningEffortValue
  outputEffort: OutputEffortValue
  chatTemplateArgs: ChatTemplateArgsValue
}

export type ModelEntry = {
  id: string
  name: string
  reasoning: boolean
  supportsImages: boolean
  modalities: Modalities
  variants: VariantEntry[]
}

type ModelCardProps = {
  m: ModelEntry
  errors: { id?: string; name?: string; variants?: Array<{ name?: string }> }
  t: Translator
  canRemove: boolean
  onChangeId: (val: string) => void
  onChangeName: (val: string) => void
  onChangeReasoning: (val: boolean) => void
  onChangeSupportsImages: (val: boolean) => void
  onRemove: () => void
}

export function ModelCard(props: ModelCardProps) {
  const issue = () => props.errors.variants?.find((error) => error.name)?.name

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "8px",
        border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
        "border-radius": "6px",
      }}
    >
      {/* Model id + name + remove */}
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

      {/* Reasoning toggle */}
      <label
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          cursor: "pointer",
          "font-size": "var(--kilo-font-size-13)",
          color: "var(--vscode-foreground)",
        }}
      >
        <input
          type="checkbox"
          checked={props.m.reasoning}
          onChange={(e) => props.onChangeReasoning(e.currentTarget.checked)}
        />
        {props.t("provider.custom.models.reasoning.label")}
      </label>

      <label
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          cursor: "pointer",
          "font-size": "var(--kilo-font-size-13)",
          color: "var(--vscode-foreground)",
        }}
      >
        <input
          type="checkbox"
          checked={props.m.supportsImages}
          onChange={(e) => props.onChangeSupportsImages(e.currentTarget.checked)}
        />
        {props.t("provider.custom.models.modalities.image")}
      </label>

      <Show when={issue()}>
        {(error) => (
          <span
            role="alert"
            style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-errorForeground)" }}
          >
            {error()}
          </span>
        )}
      </Show>
    </div>
  )
}
