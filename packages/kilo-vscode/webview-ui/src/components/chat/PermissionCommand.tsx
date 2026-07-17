/**
 * PermissionCommand component
 * Renders a bash command with preserved newlines, scrollable when long.
 * Detects heredoc patterns and shows file content in a collapsed section.
 * Includes a copy-to-clipboard button that appears on hover.
 */

import { Component, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { deferredHighlight } from "@kilocode/kilo-ui/context/marked"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { parseHeredoc } from "./permission-command-utils"

export const PermissionCommand: Component<{ command: string }> = (props) => {
  const language = useLanguage()
  const [copied, setCopied] = createSignal(false)
  const state = { signal: { aborted: false } }
  let ref: HTMLDivElement | undefined

  const heredoc = createMemo(() => parseHeredoc(props.command))
  const display = createMemo(() => (heredoc() ? heredoc()!.head : props.command))

  createEffect(() => {
    state.signal.aborted = true
    const cmd = display()
    if (!ref || !cmd) return

    const pre = document.createElement("pre")
    const code = document.createElement("code")
    code.dataset.lang = "shellscript"
    code.textContent = cmd
    pre.append(code)
    ref.replaceChildren(pre)

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
      <Show when={heredoc()}>
        {(h) => (
          <Collapsible variant="ghost" data-slot="permission-heredoc">
            <Collapsible.Trigger data-slot="permission-heredoc-trigger">
              <span data-slot="permission-heredoc-label">
                {language.t("ui.permission.heredocContent", { count: String(h().count) })}
              </span>
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content data-slot="permission-heredoc-content">
              <pre data-slot="permission-heredoc-body">
                <code>{h().body}</code>
              </pre>
            </Collapsible.Content>
          </Collapsible>
        )}
      </Show>
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
