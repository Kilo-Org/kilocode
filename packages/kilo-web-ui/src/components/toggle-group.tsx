import { splitProps, type ComponentProps } from "solid-js"
import { Toggle } from "./toggle"

export function ToggleGroup(
  props: ComponentProps<"div"> & {
    variant?: "default" | "outline"
    size?: "default" | "sm" | "lg"
    spacing?: number
    orientation?: "horizontal" | "vertical"
    value?: string[]
    onValueChange?: (value: string[]) => void
  },
) {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "spacing",
    "orientation",
    "value",
    "onValueChange",
    "class",
    "classList",
    "children",
  ])
  return (
    <div
      {...rest}
      role="group"
      data-slot="toggle-group"
      data-variant={local.variant ?? "default"}
      data-size={local.size ?? "default"}
      data-orientation={local.orientation ?? "horizontal"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </div>
  )
}

export function ToggleGroupItem(props: ComponentProps<typeof Toggle> & { value: string }) {
  return <Toggle {...props} data-slot="toggle-group-item" />
}
