import { splitProps, type ComponentProps } from "solid-js"

export function Kbd(props: ComponentProps<"kbd">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <kbd {...rest} data-slot="kbd" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </kbd>
  )
}

export function KbdGroup(props: ComponentProps<"span">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <span {...rest} data-slot="kbd-group" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </span>
  )
}
