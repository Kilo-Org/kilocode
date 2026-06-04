import { splitProps, type ComponentProps } from "solid-js"

export function AppIcon(props: ComponentProps<"span"> & { id?: string; title?: string }) {
  const [local, rest] = splitProps(props, ["id", "title", "class", "classList", "children"])
  const mark = () => local.id?.slice(0, 1).toUpperCase() || "A"
  return (
    <span
      {...rest}
      data-component="app-icon"
      title={local.title ?? local.id}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children ?? mark()}
    </span>
  )
}
