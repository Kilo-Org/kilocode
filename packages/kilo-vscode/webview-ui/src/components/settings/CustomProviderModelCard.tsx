import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { For, Show } from "solid-js"
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

type SelectOption<T> = { value: T; labelKey: string }

const ENABLE_THINKING_OPTIONS: SelectOption<EnableThinkingValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: true, labelKey: "provider.custom.models.variants.enableThinking.true" },
  { value: false, labelKey: "provider.custom.models.variants.enableThinking.false" },
]

const THINKING_OPTIONS: SelectOption<ThinkingTypeValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: "enabled", labelKey: "provider.custom.models.variants.thinking.enabled" },
  { value: "disabled", labelKey: "provider.custom.models.variants.thinking.disabled" },
  { value: "adaptive", labelKey: "provider.custom.models.variants.thinking.adaptive" },
]

const SPLIT_REASONING_OPTIONS: SelectOption<SplitReasoningValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: true, labelKey: "provider.custom.models.variants.splitReasoning.true" },
  { value: false, labelKey: "provider.custom.models.variants.splitReasoning.false" },
]

const CHAT_TEMPLATE_ARGS_OPTIONS: SelectOption<ChatTemplateArgsValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: true, labelKey: "provider.custom.models.variants.chatTemplateArgs.true" },
  { value: false, labelKey: "provider.custom.models.variants.chatTemplateArgs.false" },
]

const REASONING_EFFORT_OPTIONS: SelectOption<ReasoningEffortValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: "none", labelKey: "provider.custom.models.variants.reasoningEffort.none" },
  { value: "minimal", labelKey: "provider.custom.models.variants.reasoningEffort.minimal" },
  { value: "low", labelKey: "provider.custom.models.variants.reasoningEffort.low" },
  { value: "medium", labelKey: "provider.custom.models.variants.reasoningEffort.medium" },
  { value: "high", labelKey: "provider.custom.models.variants.reasoningEffort.high" },
  { value: "xhigh", labelKey: "provider.custom.models.variants.reasoningEffort.xhigh" },
]

const OUTPUT_EFFORT_OPTIONS: SelectOption<OutputEffortValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: "low", labelKey: "provider.custom.models.variants.outputEffort.low" },
  { value: "medium", labelKey: "provider.custom.models.variants.outputEffort.medium" },
  { value: "high", labelKey: "provider.custom.models.variants.outputEffort.high" },
  { value: "xhigh", labelKey: "provider.custom.models.variants.outputEffort.xhigh" },
  { value: "max", labelKey: "provider.custom.models.variants.outputEffort.max" },
]

type VariantRowProps = {
  v: VariantEntry
  vi: () => number
  isFirst: () => boolean
  error: { name?: string } | undefined
  t: Translator
  onChangeName: (val: string) => void
  onChangeEnableThinking: (val: EnableThinkingValue) => void
  onChangeThinking: (val: ThinkingTypeValue) => void
  onChangeSplitReasoning: (val: SplitReasoningValue) => void
  onChangeReasoningEffort: (val: ReasoningEffortValue) => void
  onChangeOutputEffort: (val: OutputEffortValue) => void
  onChangeChatTemplateArgs: (val: ChatTemplateArgsValue) => void
  onRemove: () => void
}

function VariantRow(props: VariantRowProps) {
  return (
    <div>
      <Show when={!props.isFirst()}>
        <div
          style={{
            "border-top": "1px solid var(--border-weak-base, var(--vscode-panel-border))",
            margin: "4px 0",
          }}
        />
      </Show>
      <div
        style={{
          display: "flex",
          gap: "8px",
          "align-items": "stretch",
          "flex-direction": "column",
          "padding-top": "4px",
        }}
      >
        <div style={{ "min-width": "100px", flex: "1 1 80px" }}>
          <TextField
            label={props.t("provider.custom.models.variants.name.label")}
            placeholder={props.t("provider.custom.models.variants.name.placeholder")}
            value={props.v.name}
            onChange={props.onChangeName}
            validationState={props.error?.name ? "invalid" : undefined}
            error={props.error?.name}
          />
        </div>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            flex: "0 0 auto",
          }}
        >
          <label
            style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
          >
            {props.t("provider.custom.models.variants.enableThinking.label")}
          </label>
          <Select
            options={ENABLE_THINKING_OPTIONS}
            current={ENABLE_THINKING_OPTIONS.find((o) => o.value === props.v.enableThinking)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeEnableThinking(o?.value)}
            placeholder={props.t("provider.custom.models.variants.enableThinking.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            flex: "0 0 auto",
          }}
        >
          <label
            style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
          >
            {props.t("provider.custom.models.variants.thinking.label")}
          </label>
          <Select
            options={THINKING_OPTIONS}
            current={THINKING_OPTIONS.find((o) => o.value === props.v.thinking)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeThinking(o?.value)}
            placeholder={props.t("provider.custom.models.variants.thinking.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            flex: "0 0 auto",
          }}
        >
          <label
            style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
          >
            {props.t("provider.custom.models.variants.splitReasoning.label")}
          </label>
          <Select
            options={SPLIT_REASONING_OPTIONS}
            current={SPLIT_REASONING_OPTIONS.find((o) => o.value === props.v.splitReasoning)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeSplitReasoning(o?.value)}
            placeholder={props.t("provider.custom.models.variants.splitReasoning.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            flex: "0 0 auto",
          }}
        >
          <label
            style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
          >
            {props.t("provider.custom.models.variants.reasoningEffort.label")}
          </label>
          <Select
            options={REASONING_EFFORT_OPTIONS}
            current={REASONING_EFFORT_OPTIONS.find((o) => o.value === props.v.reasoningEffort)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeReasoningEffort(o?.value)}
            placeholder={props.t("provider.custom.models.variants.reasoningEffort.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            flex: "0 0 auto",
          }}
        >
          <label
            style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
          >
            {props.t("provider.custom.models.variants.outputEffort.label")}
          </label>
          <Select
            options={OUTPUT_EFFORT_OPTIONS}
            current={OUTPUT_EFFORT_OPTIONS.find((o) => o.value === props.v.outputEffort)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeOutputEffort(o?.value)}
            placeholder={props.t("provider.custom.models.variants.outputEffort.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            flex: "0 0 auto",
          }}
        >
          <label
            style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
          >
            {props.t("provider.custom.models.variants.chatTemplateArgs.label")}
          </label>
          <Select
            options={CHAT_TEMPLATE_ARGS_OPTIONS}
            current={CHAT_TEMPLATE_ARGS_OPTIONS.find((o) => o.value === props.v.chatTemplateArgs)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeChatTemplateArgs(o?.value)}
            placeholder={props.t("provider.custom.models.variants.chatTemplateArgs.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <IconButton
          type="button"
          icon="trash"
          variant="ghost"
          onClick={props.onRemove}
          aria-label={props.t("provider.custom.models.variants.remove")}
          style={{ "margin-bottom": "4px" }}
        />
      </div>
    </div>
  )
}

type ModelCardProps = {
  m: ModelEntry
  i: () => number
  errors: { id?: string; name?: string; variants?: Array<{ name?: string }> }
  t: Translator
  canRemove: boolean
  onChangeId: (val: string) => void
  onChangeName: (val: string) => void
  onChangeReasoning: (val: boolean) => void
  onChangeSupportsImages: (val: boolean) => void
  onRemove: () => void
  onAddVariant: () => void
  onRemoveVariant: (vi: number) => void
  onChangeVariantName: (vi: number, val: string) => void
  onChangeVariantEnableThinking: (vi: number, val: EnableThinkingValue) => void
  onChangeVariantThinking: (vi: number, val: ThinkingTypeValue) => void
  onChangeVariantSplitReasoning: (vi: number, val: SplitReasoningValue) => void
  onChangeVariantReasoningEffort: (vi: number, val: ReasoningEffortValue) => void
  onChangeVariantOutputEffort: (vi: number, val: OutputEffortValue) => void
  onChangeVariantChatTemplateArgs: (vi: number, val: ChatTemplateArgsValue) => void
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

      {/* Variants — only available when reasoning is enabled */}
      <Show when={props.m.reasoning}>
        <Show when={props.m.variants.length > 0}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "0" }}>
            <label
              style={{ "font-size": "var(--kilo-font-size-11)", "font-weight": "500", color: "var(--text-weak-base)" }}
            >
              {props.t("provider.custom.models.variants.label")}
            </label>
            <For each={props.m.variants}>
              {(v, vi) => (
                <VariantRow
                  v={v}
                  vi={vi}
                  isFirst={() => vi() === 0}
                  error={props.errors.variants?.[vi()]}
                  t={props.t}
                  onChangeName={(val) => props.onChangeVariantName(vi(), val)}
                  onChangeEnableThinking={(val) => props.onChangeVariantEnableThinking(vi(), val)}
                  onChangeThinking={(val) => props.onChangeVariantThinking(vi(), val)}
                  onChangeSplitReasoning={(val) => props.onChangeVariantSplitReasoning(vi(), val)}
                  onChangeReasoningEffort={(val) => props.onChangeVariantReasoningEffort(vi(), val)}
                  onChangeOutputEffort={(val) => props.onChangeVariantOutputEffort(vi(), val)}
                  onChangeChatTemplateArgs={(val) => props.onChangeVariantChatTemplateArgs(vi(), val)}
                  onRemove={() => props.onRemoveVariant(vi())}
                />
              )}
            </For>
          </div>
        </Show>
        <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={props.onAddVariant}>
          {props.t("provider.custom.models.variants.add")}
        </Button>
      </Show>
    </div>
  )
}
