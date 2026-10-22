import { For, Show, createMemo, createSignal, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { codeContextLabel, type CodeContext } from "../../../../src/shared/code-context"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { fileName } from "./prompt-input-utils"
import { PromptShowMore } from "./PromptShowMore"

/** Rows rendered before the "show more" toggle takes over. */
const PREVIEW = 3
/** Rows after which the expanded list becomes internally scrollable. */
const SCROLL = 6
/** Characters of selected code kept in the collapsed row preview. */
const SNIPPET = 120

interface CodeContextChipsProps {
  contexts: CodeContext[]
  sessionID?: string
  onRemove?: (id: string) => void
  onClear?: () => void
}

export const CodeContextChips: Component<CodeContextChipsProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const [open, setOpen] = createSignal(true)
  const [all, setAll] = createSignal(false)
  const [full, setFull] = createSignal<string[]>([])

  const hidden = createMemo(() => (props.contexts.length > PREVIEW + 1 ? props.contexts.length - PREVIEW : 0))
  const rows = createMemo(() => (hidden() > 0 && !all() ? props.contexts.slice(0, PREVIEW) : props.contexts))
  const toggle = (id: string) =>
    setFull((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const preview = (context: CodeContext) => {
    const text = context.text.trim()
    return text.length > SNIPPET ? `${text.slice(0, SNIPPET)}...` : text
  }

  const reveal = (context: CodeContext) => {
    const event = new CustomEvent("kilo:open-file", {
      cancelable: true,
      detail: { filePath: context.filePath, line: context.startLine, column: 1, sessionID: props.sessionID },
    })
    if (window.dispatchEvent(event))
      vscode.postMessage({
        type: "openFile",
        filePath: context.filePath,
        line: context.startLine,
        column: 1,
        sessionID: props.sessionID,
      })
  }

  return (
    <div class="prompt-review-comments" data-component="code-context">
      <div class="prompt-review-comments-header">
        <button
          type="button"
          class="prompt-review-comments-toggle"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
          <Icon name="code" size="small" />
          <span class="prompt-review-comments-title">
            {language.t("ui.promptInput.context")} ({props.contexts.length})
          </span>
        </button>
        <Show when={props.onClear}>
          <Button variant="ghost" size="small" onClick={() => props.onClear?.()}>
            {language.t("agentManager.review.clearAll")}
          </Button>
        </Show>
      </div>

      <Show when={open()}>
        <div
          class="prompt-review-list"
          classList={{ "prompt-review-list--scroll": all() && props.contexts.length > SCROLL }}
        >
          <For each={rows()}>
            {(context) => (
              <div class="prompt-review-row" classList={{ "prompt-review-row--full": full().includes(context.id) }}>
                <div class="prompt-review-row-top">
                  <span class="prompt-review-row-icon">
                    <FileIcon node={{ path: context.filePath, type: "file" }} />
                  </span>
                  <button
                    type="button"
                    class="prompt-review-row-main"
                    title={codeContextLabel(context)}
                    aria-expanded={full().includes(context.id)}
                    onClick={() => toggle(context.id)}
                  >
                    <span class="prompt-review-row-head">
                      <span class="prompt-review-row-label">{fileName(context.filePath)}</span>
                      <span class="prompt-review-row-line">
                        {context.startLine}-{context.endLine}
                      </span>
                    </span>
                    <Show when={!full().includes(context.id)}>
                      <span class="prompt-review-row-preview">{preview(context)}</span>
                    </Show>
                  </button>
                  <Tooltip value={language.t("agentManager.diff.openFile")} placement="top">
                    <IconButton
                      icon="go-to-file"
                      size="small"
                      variant="ghost"
                      aria-label={language.t("agentManager.diff.openFile")}
                      onClick={() => reveal(context)}
                    />
                  </Tooltip>
                  <Show when={props.onRemove}>
                    <button
                      type="button"
                      class="prompt-review-row-remove"
                      onClick={() => props.onRemove?.(context.id)}
                      aria-label={language.t("common.delete")}
                    >
                      ×
                    </button>
                  </Show>
                </div>

                <Show when={full().includes(context.id)}>
                  <div class="prompt-review-row-detail">
                    <code class="prompt-review-row-path">
                      {context.filePath}:{context.startLine}-{context.endLine}
                    </code>
                    <pre class="prompt-review-row-snippet">{context.text}</pre>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        <PromptShowMore hidden={hidden()} all={all()} onToggle={() => setAll(!all())} />
      </Show>
    </div>
  )
}
