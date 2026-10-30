import { For, Show, createSignal, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { dataUrlText } from "../../hooks/image-attachments-utils"
import type { ImageAttachment } from "../../hooks/useImageAttachments"
import { useLanguage } from "../../context/language"

/** Rows after which the list becomes internally scrollable. */
const SCROLL = 6
/** Characters of file text kept in the collapsed row preview. */
const SNIPPET = 120

interface FileAttachmentsProps {
  files: ImageAttachment[]
  variant?: "draft" | "message"
  onRemove?: (id: string) => void
  onClear?: () => void
}

/** Text files dropped from the OS, shown like the other prompt context (code selections, browser references). */
export const FileAttachments: Component<FileAttachmentsProps> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(true)
  const [full, setFull] = createSignal<string[]>([])
  const toggle = (id: string) =>
    setFull((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const preview = (text: string) => {
    const trimmed = text.trim()
    return trimmed.length > SNIPPET ? `${trimmed.slice(0, SNIPPET)}...` : trimmed
  }

  return (
    <div
      class="prompt-review-comments"
      classList={{ "prompt-review-comments--message": props.variant === "message" }}
      data-component="file-attachments"
    >
      <div class="prompt-review-comments-header">
        <button
          type="button"
          class="prompt-review-comments-toggle"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
          <Icon name="file" size="small" />
          <span class="prompt-review-comments-title">
            {language.t("prompt.attachment.files")} ({props.files.length})
          </span>
        </button>
        <Show when={props.onClear}>
          <Button variant="ghost" size="small" onClick={() => props.onClear?.()}>
            {language.t("agentManager.review.clearAll")}
          </Button>
        </Show>
      </div>

      <Show when={open()}>
        <div class="prompt-review-list" classList={{ "prompt-review-list--scroll": props.files.length > SCROLL }}>
          <For each={props.files}>
            {(file) => {
              const text = dataUrlText(file.dataUrl)
              return (
                <div class="prompt-review-row" classList={{ "prompt-review-row--full": full().includes(file.id) }}>
                  <div class="prompt-review-row-top">
                    <span class="prompt-review-row-icon">
                      <FileIcon node={{ path: file.filename, type: "file" }} />
                    </span>
                    <button
                      type="button"
                      class="prompt-review-row-main"
                      title={file.filename}
                      aria-expanded={full().includes(file.id)}
                      onClick={() => toggle(file.id)}
                    >
                      <span class="prompt-review-row-head">
                        <span class="prompt-review-row-label">{file.filename}</span>
                      </span>
                      <Show when={!full().includes(file.id) && preview(text)}>
                        {(value) => <span class="prompt-review-row-preview">{value()}</span>}
                      </Show>
                    </button>
                    <Show when={props.onRemove}>
                      <button
                        type="button"
                        class="prompt-review-row-remove"
                        onClick={() => props.onRemove?.(file.id)}
                        aria-label={language.t("common.delete")}
                      >
                        ×
                      </button>
                    </Show>
                  </div>

                  <Show when={full().includes(file.id)}>
                    <div class="prompt-review-row-detail">
                      <pre class="prompt-review-row-snippet">{text}</pre>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
