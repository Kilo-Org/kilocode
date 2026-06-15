import { splitProps, type ComponentProps } from "solid-js"

export function ScrollView(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      {...rest}
      data-component="scroll-view"
      data-scrollable
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </div>
  )
}
