import { splitProps, type ComponentProps } from "solid-js"

function slot(props: ComponentProps<"div">, name: string) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot={name} classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function Item(
  props: ComponentProps<"div"> & { variant?: "default" | "outline" | "muted"; size?: "default" | "sm" | "xs" },
) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "classList", "children"])
  return (
    <div
      {...rest}
      data-slot="item"
      data-variant={local.variant ?? "default"}
      data-size={local.size ?? "default"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </div>
  )
}

export function ItemMedia(props: ComponentProps<"div"> & { variant?: "default" | "icon" | "image" }) {
  return slot(props, "item-media")
}
export function ItemContent(props: ComponentProps<"div">) {
  return slot(props, "item-content")
}
export function ItemActions(props: ComponentProps<"div">) {
  return slot(props, "item-actions")
}
export function ItemGroup(props: ComponentProps<"div">) {
  return slot(props, "item-group")
}
export function ItemSeparator(props: ComponentProps<"div">) {
  return slot(props, "item-separator")
}
export function ItemTitle(props: ComponentProps<"div">) {
  return slot(props, "item-title")
}
export function ItemDescription(props: ComponentProps<"div">) {
  return slot(props, "item-description")
}
export function ItemHeader(props: ComponentProps<"div">) {
  return slot(props, "item-header")
}
export function ItemFooter(props: ComponentProps<"div">) {
  return slot(props, "item-footer")
}
