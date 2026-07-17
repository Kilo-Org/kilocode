/**
 * PermissionCommand component
 * Renders a bash command with preserved newlines, scrollable when long.
 * Includes a copy-to-clipboard button that appears on hover.
 */

import { Component, createEffect, createSignal, onCleanup } from "solid-js"
import { deferredHighlight } from "@kilocode/kilo-ui/context/marked"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"

export const PermissionCommand: Component<{ command: string; plain?: boolean }> = (props) => {
  const language = useLanguage()
  const [copied, setCopied] = createSignal(false)
  const state = { signal: { aborted: false } }
  let ref: HTMLDivElement | undefined

  createEffect(() => {
    state.signal.aborted = true
    const command = props.command
    if (!ref || !command) return

    const pre = document.createElement("pre")
    const code = document.createElement("code")
    if (!props.plain) code.dataset.lang = "shellscript"
    code.textContent = command
    pre.append(code)
    ref.replaceChildren(pre)
    if (props.plain) return

    const signal = { aborted: false }
    state.signal = signal
    void deferredHighlight(ref, undefined, signal)
  })

  onCleanup(() => {
    state.signal.aborted = true
  })

  const copy = () => {
    navigator.clipboard.writeText(props.command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div data-slot="permission-command">
      <div data-slot="permission-command-code" ref={ref} />
      <Tooltip value={language.t("ui.permission.copyCommand")} placement="top">
        <button
          data-slot="permission-command-copy"
          data-copied={copied() ? "" : undefined}
          onClick={copy}
          aria-label={language.t("ui.permission.copyCommand")}
        >
          <Icon name={copied() ? "check-small" : "copy"} size="small" />
        </button>
      </Tooltip>
    </div>
  )
}
