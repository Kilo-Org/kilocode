import { Button as Kobalte } from "@kobalte/core/button"
import { Show, splitProps, type ComponentProps } from "solid-js"
import { Icon, type IconProps } from "./icon"

type Size = "xs" | "sm" | "small" | "normal" | "default" | "large" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
type Variant = "primary" | "default" | "secondary" | "outline" | "ghost" | "destructive" | "link"

export interface ButtonProps
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: Size
  variant?: Variant
  icon?: IconProps["name"]
}

function size(value: Size | undefined) {
  if (!value || value === "normal") return "default"
  if (value === "small") return "sm"
  if (value === "large") return "lg"
  return value
}

function variant(value: Variant | undefined) {
  if (!value || value === "default") return "primary"
  return value
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList", "children"])
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={size(local.size)}
      data-variant={variant(local.variant)}
      data-icon={local.icon ? "inline-start" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={local.icon}>{(name) => <Icon name={name()} size="small" />}</Show>
      {local.children}
    </Kobalte>
  )
}

export function buttonVariants() {
  return ""
}
