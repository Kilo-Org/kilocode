import { splitProps, type ComponentProps } from "solid-js"

export function Separator(props: ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  const [local, rest] = splitProps(props, ["orientation", "class", "classList"])
  return (
    <div
      {...rest}
      role="separator"
      data-slot="separator"
      data-orientation={local.orientation ?? "horizontal"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    />
  )
}
