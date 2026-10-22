import { splitProps, type ComponentProps } from "solid-js"

export function Textarea(props: ComponentProps<"textarea">) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <textarea
      {...rest}
      data-component="textarea"
      data-slot="textarea"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    />
  )
}
