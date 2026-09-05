/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useVSCode } from "../../src/context/vscode"

export function CopyButton(props: { text: string; label?: string; class?: string }) {
  const vscode = useVSCode()
  const [copied, setCopied] = createSignal(false)
  const copy = () => {
    vscode.postMessage({ type: "agentManager.copyToClipboard", text: props.text })
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
