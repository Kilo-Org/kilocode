// The model row of the custom provider dialog: id, display name, the Reasoning and Image toggles and a remove
// button. The variant fields are not editable here and are carried through unchanged.
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../context/language"
import type { ModelEntry, ModelErrors } from "./CustomProviderValidation"

export type Translator = ReturnType<typeof useLanguage>["t"]

type ModelCardProps = {
  m: ModelEntry
  errors: ModelErrors
  t: Translator
  canRemove: boolean
  onChangeId: (value: string) => void
  onChangeName: (value: string) => void
  onChangeReasoning: (value: boolean) => void
  onChangeSupportsImages: (value: boolean) => void
  onRemove: () => void
}

export function ModelCard(props: ModelCardProps) {
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

      <div style={{ display: "flex", gap: "16px", "align-items": "center", "flex-wrap": "wrap" }}>
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
      </div>
    </div>
  )
}
