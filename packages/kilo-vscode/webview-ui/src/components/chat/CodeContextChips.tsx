import { For, Show, createMemo, createSignal, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PromptAttachment, ToHost } from "../../../../src/protocol"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { attachmentText } from "../../v2/prompt-attachments"
import { PromptRowActions } from "./PromptRowActions"
import { PromptShowMore } from "./PromptShowMore"

/** Rows rendered before the "show more" toggle takes over. */
const PREVIEW = 3
/** Rows after which the expanded list becomes internally scrollable. */
const SCROLL = 6
/** Characters of attachment text kept in the collapsed row preview. */
const SNIPPET = 120

interface CodeContextChipsProps {
  items: readonly PromptAttachment[]
  onRemove?: (id: string) => void
  onClear?: () => void
  disabled?: boolean
}

export const CodeContextChips: Component<CodeContextChipsProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const [open, setOpen] = createSignal(true)
  const [all, setAll] = createSignal(false)
  const [full, setFull] = createSignal<string[]>([])

  const contexts = createMemo(() => props.items.filter((item) => item.kind !== "image"))
  const hidden = createMemo(() => (contexts().length > PREVIEW + 1 ? contexts().length - PREVIEW : 0))
  const rows = createMemo(() => (hidden() > 0 && !all() ? contexts().slice(0, PREVIEW) : contexts()))
  const toggle = (id: string) =>
    setFull((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const text = (item: PromptAttachment) => attachmentText(item)
  const preview = (item: PromptAttachment) => {
    const value = text(item) ?? item.description ?? ""
    const trimmed = value.trim()
    return trimmed.length > SNIPPET ? `${trimmed.slice(0, SNIPPET)}...` : trimmed
  }
  const expandable = (item: PromptAttachment) => !!text(item)

  const reveal = (item: PromptAttachment) => {
    if (!item.path) return
    vscode.postMessage({
      type: "openToolFile",
      filePath: item.path,
      line: item.line,
    } satisfies ToHost as never)
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
            {language.t("ui.promptInput.context")} ({contexts().length})
          </span>
        </button>
        <Show when={props.onClear}>
          <Button variant="ghost" size="small" onClick={() => props.onClear?.()} disabled={props.disabled}>
            {language.t("agentManager.review.clearAll")}
          </Button>
        </Show>
      </div>

      <Show when={open()}>
        <div
          class="prompt-review-list"
          classList={{ "prompt-review-list--scroll": all() && contexts().length > SCROLL }}
        >
          <For each={rows()}>
            {(item) => (
              <div class="prompt-review-row" classList={{ "prompt-review-row--full": full().includes(item.id) }}>
                <div class="prompt-review-row-top">
                  <span class="prompt-review-row-icon">
                    <Show
                      when={item.kind === "terminal"}
                      fallback={<FileIcon node={{ path: item.path ?? item.name, type: "file" }} />}
                    >
                      <Icon name="console" size="small" />
                    </Show>
                  </span>
                  <button
                    type="button"
                    class="prompt-review-row-main"
                    title={item.description ?? item.name}
                    aria-expanded={full().includes(item.id)}
                    disabled={props.disabled || !expandable(item)}
                    onClick={() => toggle(item.id)}
                  >
                    <span class="prompt-review-row-head">
                      <span class="prompt-review-row-label">{item.name}</span>
                    </span>
                    <Show when={!full().includes(item.id)}>
                      <span class="prompt-review-row-preview">{preview(item)}</span>
                    </Show>
                  </button>
                  <PromptRowActions
                    onOpen={item.path ? () => reveal(item) : undefined}
                    onRemove={props.onRemove ? () => props.onRemove?.(item.id) : undefined}
                    disabled={props.disabled}
                  />
                </div>

                <Show when={full().includes(item.id)}>
                  <div class="prompt-review-row-detail">
                    <code class="prompt-review-row-path">
                      {item.path ?? item.name}
                      <Show when={item.line !== undefined}>:{item.line}</Show>
                    </code>
                    <pre class="prompt-review-row-snippet">{text(item) ?? item.description ?? ""}</pre>
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
