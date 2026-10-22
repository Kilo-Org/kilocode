import { splitProps, type ComponentProps } from "solid-js"
import { Tag } from "./tag"

export interface BadgeProps extends ComponentProps<"span"> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link"
}

export function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, ["variant", "class", "classList", "children"])
  const tone = () => {
    if (local.variant === "destructive") return "critical" as const
    if (local.variant === "default") return "brand" as const
    return "neutral" as const
  }
  return (
    <Tag
      {...rest}
      data-variant={local.variant ?? "default"}
      tone={tone()}
      class={local.class}
      classList={local.classList}
    >
      {local.children}
    </Tag>
  )
}

export function badgeVariants() {
  return ""
}
