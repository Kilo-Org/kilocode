import type { ComponentProps } from "solid-js"

export function Diff(props: ComponentProps<"pre">) {
  return <pre {...props} data-component="diff" />
}
