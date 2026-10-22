import { splitProps, type ComponentProps } from "solid-js"

export function Label(props: ComponentProps<"label">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <label
      {...rest}
      data-component="label"
      data-slot="label"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </label>
  )
}
