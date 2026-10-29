import { Control, Description, ErrorMessage, Input, Label, Root, Thumb } from "@kobalte/core/switch"
import { Show, splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"

// The v2 UI packages ship the switch stylesheet but not the component, so the settings tabs keep their own copy of the
// same Kobalte markup. `@kilocode/kilo-ui/styles` carries the switch rules that style it.
export interface SwitchProps extends ParentProps<ComponentProps<typeof Root>> {
  appearance?: "standard" | "compact"
  hideLabel?: boolean
  description?: string
}

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ["children", "class", "appearance", "hideLabel", "description"])

  return (
    <Root {...others} class={local.class} data-component="switch" data-appearance={local.appearance ?? "compact"}>
      <Input data-slot="switch-input" />
      <Show when={local.children}>
        {(label) => (
          <Label data-slot="switch-label" classList={{ "sr-only": local.hideLabel }}>
            {label()}
          </Label>
        )}
      </Show>
      <Show when={local.description}>
        <Description data-slot="switch-description">{local.description}</Description>
      </Show>
      <Control data-slot="switch-control">
        <Thumb data-slot="switch-thumb" />
      </Control>
      <ErrorMessage data-slot="switch-error" />
    </Root>
  )
}

export default Switch
