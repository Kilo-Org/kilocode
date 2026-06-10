import { splitProps, type ComponentProps } from "solid-js"

type Props = Omit<ComponentProps<"input">, "onInput" | "type" | "value"> & {
  label: string
  value: string
  variant?: "list" | "drawer"
  hideLabel?: boolean
  inputClass?: string
  onValue: (value: string) => void
}

export function SearchField(props: Props) {
  const [local, rest] = splitProps(props, [
    "label",
    "value",
    "variant",
    "hideLabel",
    "inputClass",
    "class",
    "classList",
    "onValue",
  ])

  return (
    <label
      data-component="search-field"
      data-variant={local.variant ?? "list"}
      data-label={local.hideLabel === false ? "visible" : "hidden"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <span data-slot="search-label">{local.label}</span>
      <input
        {...rest}
        class={local.inputClass}
        type="search"
        value={local.value}
        aria-label={local.hideLabel === false ? undefined : local.label}
        onInput={(event) => local.onValue(event.currentTarget.value)}
      />
    </label>
  )
}
