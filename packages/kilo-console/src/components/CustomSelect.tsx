import { For } from "solid-js"

export type SelectOption<T extends string = string> = {
  value: T
  label: string
  disabled?: boolean
}

export function CustomSelect<T extends string>(props: {
  label: string
  value: T
  options: readonly SelectOption<T>[]
  class?: string
  disabled?: boolean
  invalid?: boolean
  onSelect: (value: T) => void
}) {
  const current = () => props.options.find((option) => option.value === props.value)?.label ?? props.value

  function choose(option: SelectOption<T>, event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    if (props.disabled || option.disabled) return
    props.onSelect(option.value)
    event.currentTarget.closest("details")?.removeAttribute("open")
  }

  function toggle(event: Event & { currentTarget: HTMLDetailsElement }) {
    if (props.disabled) {
      event.currentTarget.removeAttribute("open")
      return
    }
    if (!event.currentTarget.open) return
    event.currentTarget.parentElement?.querySelectorAll(".models-select[open]").forEach((node) => {
      if (node !== event.currentTarget) node.removeAttribute("open")
    })
  }

  return (
    <details
      class={`models-select ${props.class ?? ""}`}
      classList={{ disabled: props.disabled, invalid: props.invalid }}
      onToggle={toggle}
    >
      <summary aria-label={props.label} aria-disabled={props.disabled}>
        {current()}
      </summary>
      <div class="models-select-menu" role="listbox" aria-label={props.label}>
        <For each={props.options}>
          {(option) => (
            <button
              class="models-select-option"
              classList={{ selected: option.value === props.value, disabled: option.disabled }}
              type="button"
              role="option"
              aria-selected={option.value === props.value}
              disabled={props.disabled || option.disabled}
              onClick={(event) => choose(option, event)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </details>
  )
}
