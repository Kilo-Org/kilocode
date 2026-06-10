import { splitProps, type ComponentProps, type JSX } from "solid-js"
import { Icon, type IconProps } from "./icon"
import { css } from "./utils"

type Variant = "normal" | "error" | "warning" | "success" | "info"

export interface CardProps extends ComponentProps<"div"> {
  variant?: Variant
  size?: "default" | "sm"
  padding?: number | string
}

export interface CardTitleProps extends ComponentProps<"div"> {
  variant?: Variant
  icon?: IconProps["name"] | false | null
}

function icon(variant: Variant) {
  if (variant === "error") return "circle-ban-sign" as const
  if (variant === "warning") return "warning" as const
  if (variant === "success") return "circle-check" as const
  if (variant === "info") return "help" as const
  return undefined
}

export function Card(props: CardProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "padding", "style", "class", "classList", "children"])
  const pad = () => (typeof local.padding === "number" ? `${local.padding}px` : local.padding)
  return (
    <div
      {...rest}
      data-component="card"
      data-variant={local.variant ?? "normal"}
      data-size={local.size ?? "default"}
      style={css(local.style as JSX.CSSProperties | string | undefined, { "--kw-card-padding": pad() })}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </div>
  )
}

export function CardHeader(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-header" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function CardTitle(props: CardTitleProps) {
  const [local, rest] = splitProps(props, ["variant", "icon", "class", "classList", "children"])
  const name = () => {
    if (local.icon === false || local.icon === null) return undefined
    if (typeof local.icon === "string") return local.icon
    return icon(local.variant ?? "normal")
  }
  return (
    <div {...rest} data-slot="card-title" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {name() ? <Icon name={name()!} size="small" /> : null}
      {local.children}
    </div>
  )
}

export function CardDescription(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-description" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function CardAction(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-action" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function CardActions(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-actions" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function CardContent(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-content" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function CardFooter(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-footer" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}
