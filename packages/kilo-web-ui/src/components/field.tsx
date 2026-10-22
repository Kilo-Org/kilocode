import { splitProps, type ComponentProps } from "solid-js"
import { Label } from "./label"

export function Field(
  props: ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" | "responsive"; invalid?: boolean },
) {
  const [local, rest] = splitProps(props, ["orientation", "invalid", "class", "classList", "children"])
  return (
    <div
      {...rest}
      role="group"
      data-slot="field"
      data-orientation={local.orientation ?? "vertical"}
      data-invalid={local.invalid || undefined}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </div>
  )
}

export function FieldSet(props: ComponentProps<"fieldset">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <fieldset {...rest} data-slot="field-set" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </fieldset>
  )
}

export function FieldLegend(props: ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  const [local, rest] = splitProps(props, ["variant", "class", "classList", "children"])
  return (
    <legend
      {...rest}
      data-slot="field-legend"
      data-variant={local.variant ?? "legend"}
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </legend>
  )
}

export function FieldGroup(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="field-group" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function FieldContent(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="field-content" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function FieldLabel(props: ComponentProps<typeof Label>) {
  return <Label {...props} data-slot="field-label" />
}

export function FieldTitle(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="field-title" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function FieldDescription(props: ComponentProps<"p">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <p {...rest} data-slot="field-description" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </p>
  )
}

export function FieldError(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      {...rest}
      role="alert"
      data-slot="field-error"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
    >
      {local.children}
    </div>
  )
}

export function FieldSeparator(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="field-separator" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}
