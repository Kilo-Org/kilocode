import { splitProps, type ComponentProps } from "solid-js"

export function Skeleton(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <div
      {...rest}
      data-slot="skeleton"
      aria-hidden="true"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    />
  )
}
