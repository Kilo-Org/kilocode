import { Button as Kobalte } from "@kobalte/core/button"
import { Show, type ComponentProps, splitProps } from "solid-js"
import { Icon, IconProps } from "./icon"
import { Spinner } from "./spinner"

export interface IconButtonProps extends ComponentProps<typeof Kobalte> {
  icon: IconProps["name"]
  size?: "small" | "normal" | "large"
  iconSize?: IconProps["size"]
  variant?: "primary" | "secondary" | "ghost"
  shape?: "circle"
  tone?: "danger" | "success"
  label?: string
  loading?: boolean
}

export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [split, rest] = splitProps(props, [
    "icon",
    "variant",
    "shape",
    "size",
    "iconSize",
    "tone",
    "class",
    "classList",
    "label",
    "loading",
    "children",
  ])
  const label = () => props["aria-label"] ?? split.label ?? props.icon
  const busy = () => split.loading === true
  const disabled = () => props.disabled === true || busy()
  const aria = () => (disabled() ? "true" : (props["aria-disabled"] ?? "false"))
  return (
    <Kobalte
      {...rest}
      data-component="icon-button"
      data-icon={props.icon}
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      data-shape={split.shape}
      data-tone={split.tone}
      data-content={split.children != null ? "true" : undefined}
      data-loading={busy() ? "true" : undefined}
      type={props.type ?? "button"}
      aria-label={label()}
      aria-busy={busy() || props["aria-busy"]}
      aria-disabled={aria()}
      disabled={disabled()}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show
        when={!busy()}
        fallback={
          <Spinner
            class="icon-button-spinner"
            style={{ width: split.iconSize === "normal" ? "20px" : split.iconSize === "medium" ? "24px" : "16px" }}
          />
        }
      >
        <Icon name={props.icon} size={split.iconSize ?? (split.size === "large" ? "normal" : "small")} />
      </Show>
      {split.children}
    </Kobalte>
  )
}
