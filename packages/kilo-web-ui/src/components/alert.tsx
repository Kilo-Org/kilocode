import { splitProps, type ComponentProps } from "solid-js"

export function Alert(props: ComponentProps<"div"> & { variant?: "default" | "destructive" }) {
  const [local, rest] = splitProps(props, ["variant", "class", "classList", "children"])
  return (
    <div
      {...rest}
      role="alert"
      data-slot="alert"
      data-variant={local.variant ?? "default"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </div>
  )
}

export function AlertTitle(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="alert-title" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function AlertDescription(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="alert-description" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function AlertAction(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="alert-action" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}
