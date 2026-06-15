import { splitProps, type ComponentProps } from "solid-js"

export function Toggle(
  props: ComponentProps<"button"> & { variant?: "default" | "outline"; size?: "default" | "sm" | "lg" },
) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "classList", "children"])
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      data-slot="toggle"
      data-variant={local.variant ?? "default"}
      data-size={local.size ?? "default"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </button>
  )
}

export function toggleVariants() {
  return ""
}
