// A model picker for settings: the shared ModelSelector over the v2 model catalog, plus a variant picker when the
// selected model has variants. `clearable` adds a clear control that calls `onChange` with undefined.
import { Component, Show, createMemo } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useV2 } from "../../v2/client"
import { ModelSelectorBase } from "../shared/ModelSelector"
import { ThinkingSelectorBase } from "../shared/ThinkingSelector"

export interface ModelPickerValue {
  providerID: string
  modelID: string
  variant?: string
}

export interface ModelPickerProps {
  value?: ModelPickerValue
  onChange: (value: ModelPickerValue | undefined) => void
  clearLabel: string
  clearable?: boolean
  blocked?: boolean
  /** Show the variant picker when the selected model has variants. Defaults to true. */
  showVariants?: boolean
  preserveVariantOnReselect?: boolean
  showUnavailableVariant?: boolean
  modelLabel?: string
  variantLabel?: string
  clearButtonLabel?: string
}

const ModelPicker: Component<ModelPickerProps> = (props) => {
  const v2 = useV2()
  const models = () => v2.data.location.model.list()
  const providers = () => v2.data.location.provider.list()

  const selected = createMemo(() =>
    models()?.find((model) => model.providerID === props.value?.providerID && model.id === props.value?.modelID),
  )
  const variants = createMemo(() => selected()?.variants.map((variant) => variant.id) ?? [])

  return (
    <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
      <ModelSelectorBase
        models={models()}
        providers={providers()}
        value={props.value ? { providerID: props.value.providerID, modelID: props.value.modelID } : null}
        blocked={props.blocked}
        placeholder={props.clearLabel}
        label={props.modelLabel}
        onSelect={(providerID, modelID) =>
          props.onChange(
            props.preserveVariantOnReselect && props.value?.providerID === providerID && props.value.modelID === modelID
              ? props.value
              : { providerID, modelID },
          )
        }
      />
      <Show
        when={
          props.showVariants !== false &&
          (variants().length > 0 || (props.showUnavailableVariant && props.value?.variant))
        }
      >
        <ThinkingSelectorBase
          variants={variants()}
          value={props.value?.variant}
          onSelect={(variant) => props.value && props.onChange({ ...props.value, variant })}
          onClear={() =>
            props.value && props.onChange({ providerID: props.value.providerID, modelID: props.value.modelID })
          }
          allowClear
          clearLabel={props.clearLabel}
          placement="bottom-start"
          globalTrigger={false}
          blocked={props.blocked}
          label={props.variantLabel}
        />
      </Show>
      <Show when={props.clearable && props.value}>
        <IconButton
          size="small"
          variant="ghost"
          icon="close"
          aria-label={props.clearButtonLabel ?? props.clearLabel}
          onClick={() => props.onChange(undefined)}
        />
      </Show>
    </div>
  )
}

export default ModelPicker
