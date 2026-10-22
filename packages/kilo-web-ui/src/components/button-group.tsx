import { splitProps, type ComponentProps } from "solid-js"

export function ButtonGroup(props: ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  const [local, rest] = splitProps(props, ["orientation", "class", "classList", "children"])
  return (
    <div
      {...rest}
      role="group"
      data-slot="button-group"
      data-orientation={local.orientation ?? "horizontal"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </div>
  )
}

export function ButtonGroupText(props: ComponentProps<"div">) {
  return <div {...props} data-slot="button-group-text" />
}

export function ButtonGroupSeparator(props: ComponentProps<"div">) {
  return <div {...props} data-slot="button-group-separator" />
}

export function buttonGroupVariants() {
  return ""
}
