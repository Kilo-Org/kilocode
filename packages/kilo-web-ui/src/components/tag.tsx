import { splitProps, type ComponentProps } from "solid-js"

type Tone = "neutral" | "success" | "warning" | "critical" | "info" | "brand"

export interface TagProps extends ComponentProps<"span"> {
  size?: "normal" | "large"
  tone?: Tone
}

export function Tag(props: TagProps) {
  const [local, rest] = splitProps(props, ["size", "tone", "class", "classList", "children"])
  return (
    <span
      {...rest}
      data-component="tag"
      data-size={local.size ?? "normal"}
      data-tone={local.tone ?? "neutral"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </span>
  )
}

export function CountTag(props: ComponentProps<"span">) {
  return <Tag {...props} tone="neutral" />
}
