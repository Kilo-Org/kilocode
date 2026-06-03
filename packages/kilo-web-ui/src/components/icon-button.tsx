import { Button as Kobalte } from "@kobalte/core/button"
import { Show, splitProps, type ComponentProps } from "solid-js"
import { Icon, type IconProps } from "./icon"

export interface IconButtonProps
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  icon?: IconProps["name"]
  size?: "small" | "normal" | "large" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
  iconSize?: IconProps["size"]
  variant?: "primary" | "default" | "secondary" | "outline" | "ghost" | "destructive"
  active?: boolean
}

function size(value: IconButtonProps["size"]) {
  if (!value || value === "normal") return "icon"
  if (value === "small") return "icon-sm"
  if (value === "large") return "icon-lg"
  return value
}

function variant(value: IconButtonProps["variant"]) {
  if (!value || value === "default") return "secondary"
  return value
}

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "icon",
    "iconSize",
    "active",
    "class",
    "classList",
    "children",
  ])
  return (
    <Kobalte
      {...rest}
      data-component="icon-button"
      data-size={size(local.size)}
      data-variant={variant(local.variant)}
      data-active={local.active || undefined}
      aria-pressed={local.active || undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={local.icon}>{(name) => <Icon name={name()} size={local.iconSize ?? "small"} />}</Show>
      {local.children}
    </Kobalte>
  )
}
