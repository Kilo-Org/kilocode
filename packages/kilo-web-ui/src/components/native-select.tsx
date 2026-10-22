import { splitProps, type ComponentProps } from "solid-js"
import { Icon } from "./icon"

type Props = Omit<ComponentProps<"select">, "size"> & { size?: "sm" | "default" }

export function NativeSelect(props: Props) {
  const [local, rest] = splitProps(props, ["size", "class", "classList", "children"])
  return (
    <div
      data-slot="native-select-wrapper"
      data-size={local.size ?? "default"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      <select {...rest} data-slot="native-select">
        {local.children}
      </select>
      <Icon name="selector" size="small" />
    </div>
  )
}

export function NativeSelectOption(props: ComponentProps<"option">) {
  return <option {...props} data-slot="native-select-option" />
}

export function NativeSelectOptGroup(props: ComponentProps<"optgroup">) {
  return <optgroup {...props} data-slot="native-select-optgroup" />
}
