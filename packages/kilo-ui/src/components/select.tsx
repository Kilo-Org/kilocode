import { Select as Base, type SelectProps } from "@opencode-ai/ui/select"
import type { ButtonProps } from "@opencode-ai/ui/button"
import { changed } from "./select-change"

export * from "@opencode-ai/ui/select"

export function Select<T>(props: SelectProps<T> & Omit<ButtonProps, "children">) {
  const key = (item: T) => (props.value ? props.value(item) : (item as string))

  return (
    <Base
      {...props}
      onSelect={(next) => {
        if (!changed(props.current, next, key)) return
        props.onSelect?.(next)
      }}
    />
  )
}
