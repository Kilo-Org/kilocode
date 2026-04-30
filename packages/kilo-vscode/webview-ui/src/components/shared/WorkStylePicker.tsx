import { For, Show } from "solid-js"
import type { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useWorkStyle } from "../../context/work-style"
import { WORK_STYLE_CHOICES, type WorkStyle } from "../../../../src/shared/work-style-presets"

interface WorkStylePickerProps {
  variant: "onboarding" | "settings"
}

export const WorkStylePicker: Component<WorkStylePickerProps> = (props) => {
  const language = useLanguage()
  const work = useWorkStyle()
  const onboarding = () => props.variant === "onboarding"

  const choose = (style: WorkStyle) => {
    work.apply(style, { source: props.variant, force: !onboarding() })
  }

  return (
    <div data-component="work-style-picker" data-variant={props.variant}>
      <div data-slot="work-style-header">
        <div data-slot="work-style-title">
          {language.t(onboarding() ? "workStyle.onboarding.title" : "workStyle.settings.title")}
        </div>
        <div data-slot="work-style-description">
          {language.t(onboarding() ? "workStyle.onboarding.description" : "workStyle.settings.description")}
        </div>
      </div>

      <div data-slot="work-style-options">
        <For each={WORK_STYLE_CHOICES}>
          {(choice) => {
            const selected = () => work.style() === choice.id
            return (
              <button
                type="button"
                data-slot="work-style-option"
                data-selected={selected() ? "" : undefined}
                onClick={() => choose(choice.id)}
              >
                <div data-slot="work-style-option-header">
                  <div data-slot="work-style-option-heading">
                    <span data-slot="work-style-option-eyebrow">{choice.eyebrow}</span>
                    <span data-slot="work-style-option-title">{choice.title}</span>
                  </div>
                  <Show when={selected()}>
                    <Icon name="check" size="small" />
                  </Show>
                </div>
                <div data-slot="work-style-option-description">{choice.description}</div>
                <div data-slot="work-style-option-changes">
                  <For each={choice.changes}>
                    {(item) => (
                      <div data-slot="work-style-option-change">
                        <span data-slot="work-style-option-change-label">{item.label}</span>
                        <span data-slot="work-style-option-change-value">{item.value}</span>
                      </div>
                    )}
                  </For>
                </div>
              </button>
            )
          }}
        </For>
      </div>

      <Show when={onboarding()}>
        <div data-slot="work-style-actions">
          <Button variant="ghost" size="small" onClick={work.dismiss}>
            {language.t("workStyle.onboarding.skip")}
          </Button>
        </div>
      </Show>
    </div>
  )
}
