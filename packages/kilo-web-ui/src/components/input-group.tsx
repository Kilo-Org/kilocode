import { splitProps, type ComponentProps } from "solid-js"
import { Button, type ButtonProps } from "./button"
import { Input } from "./input"
import { Textarea } from "./textarea"

export function InputGroup(props: ComponentProps<"div">) {
  return <div {...props} role="group" data-slot="input-group" />
}

export function InputGroupAddon(
  props: ComponentProps<"div"> & { align?: "inline-start" | "inline-end" | "block-start" | "block-end" },
) {
  const [local, rest] = splitProps(props, ["align"])
  return <div {...rest} data-slot="input-group-addon" data-align={local.align ?? "inline-start"} />
}

export function InputGroupButton(props: ButtonProps) {
  return <Button {...props} data-slot="input-group-button" />
}

export function InputGroupText(props: ComponentProps<"span">) {
  return <span {...props} data-slot="input-group-text" />
}

export function InputGroupInput(props: ComponentProps<typeof Input>) {
  return <Input {...props} data-slot="input-group-control" />
}

export function InputGroupTextarea(props: ComponentProps<typeof Textarea>) {
  return <Textarea {...props} data-slot="input-group-control" />
}
