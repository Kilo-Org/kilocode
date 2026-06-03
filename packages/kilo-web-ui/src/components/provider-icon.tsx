import { splitProps, type Component } from "solid-js"
import { ProviderIcon as Icon, type ProviderIconProps } from "@kilocode/kilo-ui/provider-icon"

export type { ProviderIconProps }

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  if (local.id !== "kilo") return <Icon {...props} />

  return (
    <svg
      data-component="provider-icon"
      data-provider="kilo"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <rect width="16" height="16" rx="3" fill="var(--primary)" />
      <text
        x="8"
        y="8.15"
        dominant-baseline="middle"
        fill="var(--primary-foreground)"
        font-size="10"
        font-weight="700"
        letter-spacing="-0.025em"
        text-anchor="middle"
      >
        K
      </text>
    </svg>
  )
}
