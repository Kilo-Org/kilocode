import { splitProps, type ComponentProps } from "solid-js"

export function Input(props: ComponentProps<"input">) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <input
      {...rest}
      data-component="input"
      data-slot="input"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    />
  )
}
