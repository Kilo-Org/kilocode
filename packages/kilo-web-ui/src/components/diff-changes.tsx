import type { ComponentProps } from "solid-js"

export function DiffChanges(props: ComponentProps<"pre">) {
  return <pre {...props} data-component="diff-changes" />
}
