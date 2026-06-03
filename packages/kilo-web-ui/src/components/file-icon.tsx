import { splitProps, type ComponentProps } from "solid-js"

export function FileIcon(props: ComponentProps<"span"> & { filename?: string; title?: string }) {
  const [local, rest] = splitProps(props, ["filename", "title", "class", "classList", "children"])
  const ext = () => local.filename?.split(".").at(-1)?.slice(0, 2).toUpperCase() || "F"
  return (
    <span
      {...rest}
      data-component="file-icon"
      title={local.title ?? local.filename}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children ?? ext()}
    </span>
  )
}
