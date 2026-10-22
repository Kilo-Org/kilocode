import { splitProps, type ComponentProps } from "solid-js"

export function Slider(
  props: Omit<ComponentProps<"input">, "value" | "onInput"> & {
    value?: number[]
    defaultValue?: number[]
    onValueChange?: (value: number[]) => void
  },
) {
  const [local, rest] = splitProps(props, ["value", "defaultValue", "onValueChange"])
  const value = () => local.value?.[0] ?? local.defaultValue?.[0] ?? Number(rest.min ?? 0)
  return (
    <input
      {...rest}
      data-slot="slider"
      type="range"
      value={value()}
      onInput={(event) => local.onValueChange?.([Number(event.currentTarget.value)])}
    />
  )
}
