import { createSignal, splitProps, type ComponentProps } from "solid-js"
import { Input } from "./input"

export function Combobox(props: ComponentProps<"div">) {
  return <div {...props} data-slot="combobox" />
}

export function ComboboxInput(props: ComponentProps<typeof Input> & { showTrigger?: boolean; showClear?: boolean }) {
  const [local, rest] = splitProps(props, ["showTrigger", "showClear"])
  return <Input {...rest} data-slot="combobox-input" />
}

export function ComboboxContent(props: ComponentProps<"div">) {
  return <div {...props} data-slot="combobox-content" />
}

export function ComboboxList(props: ComponentProps<"div">) {
  return <div {...props} role="listbox" data-slot="combobox-list" />
}

export function ComboboxItem(props: ComponentProps<"div">) {
  return <div {...props} role="option" data-slot="combobox-item" />
}

export function ComboboxGroup(props: ComponentProps<"div">) {
  return <div {...props} data-slot="combobox-group" />
}

export function ComboboxLabel(props: ComponentProps<"div">) {
  return <div {...props} data-slot="combobox-label" />
}

export function ComboboxCollection(props: ComponentProps<"div">) {
  return <div {...props} data-slot="combobox-collection" />
}

export function ComboboxEmpty(props: ComponentProps<"div">) {
  return <div {...props} data-slot="combobox-empty" />
}

export function ComboboxSeparator(props: ComponentProps<"div">) {
  return <div {...props} data-slot="combobox-separator" />
}

export function ComboboxChips(props: ComponentProps<"div">) {
  return <div {...props} data-slot="combobox-chips" />
}

export function ComboboxChip(props: ComponentProps<"span"> & { showRemove?: boolean }) {
  const [local, rest] = splitProps(props, ["showRemove"])
  return <span {...rest} data-slot="combobox-chip" />
}

export function ComboboxChipsInput(props: ComponentProps<"input">) {
  return <input {...props} data-slot="combobox-chip-input" />
}

export function ComboboxTrigger(props: ComponentProps<"button">) {
  return <button {...props} type={props.type ?? "button"} data-slot="combobox-trigger" />
}

export function ComboboxValue(props: ComponentProps<"span">) {
  return <span {...props} data-slot="combobox-value" />
}

export function useComboboxAnchor() {
  const [node, setNode] = createSignal<HTMLElement>()
  return { node, setNode }
}
