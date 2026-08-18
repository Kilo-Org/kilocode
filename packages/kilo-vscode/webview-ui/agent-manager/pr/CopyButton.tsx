/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

export function CopyButton(props: { text: string; label?: string; class?: string }) {
  const [copied, setCopied] = createSignal(false)
  const copy = () => {
    navigator.clipboard.writeText(props.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <IconButton
      icon={copied() ? "check" : "copy"}
      size="small"
      variant="ghost"
      label={props.label ?? "Copy"}
      class={props.class}
      onClick={copy}
    />
  )
}
