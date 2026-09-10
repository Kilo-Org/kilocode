import { Select as Base, type SelectProps } from "@kilocode/ide-ui/select"
import type { ButtonProps } from "@kilocode/ide-ui/button"
import { changed } from "./select-change"

export * from "@kilocode/ide-ui/select"

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
