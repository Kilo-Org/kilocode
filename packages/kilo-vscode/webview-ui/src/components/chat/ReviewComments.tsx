import { For, Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ReviewComment } from "../../types/messages"
import { fileName } from "./prompt-input-utils"

interface ReviewCommentsProps {
  comments: ReviewComment[]
  sessionID?: string
  variant?: "draft" | "message"
  onRemove?: (id: string) => void
  onClear?: () => void
}

export const ReviewComments: Component<ReviewCommentsProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const side = (item: ReviewComment) => (item.side === "deletions" ? "-" : "+")

  const open = (item: ReviewComment) => {
    const event = new CustomEvent("kilo:open-file", {
      cancelable: true,
      detail: { filePath: item.file, line: item.line, column: 1, sessionID: props.sessionID },
    })
    if (window.dispatchEvent(event))
      vscode.postMessage({ type: "openFile", filePath: item.file, line: item.line, column: 1 })
  }

  return (
    <div
      class="prompt-review-comments"
      classList={{ "prompt-review-comments--message": props.variant === "message" }}
      data-component="review-comments"
    >
      <div class="prompt-review-comments-header">
        <span class="prompt-review-comments-title">
          {language.t("agentManager.review.inlineCount", { count: props.comments.length })}
        </span>
        <Show when={props.onClear}>
          <Button variant="ghost" size="small" onClick={() => props.onClear?.()}>
            {language.t("agentManager.review.clearAll")}
          </Button>
        </Show>
      </div>
      <div class="prompt-review-chip-list">
        <For each={props.comments}>
          {(item) => (
            <div class="prompt-review-chip">
              <button type="button" class="prompt-review-chip-body" onClick={() => open(item)}>
                <span class="prompt-review-chip-icon">
                  <Icon name="comment" size="small" />
                </span>
                <span class="prompt-review-chip-copy">
                  <span class="prompt-review-chip-main">
                    <span class="prompt-review-chip-title">{fileName(item.file)}</span>
                    <span class="prompt-review-chip-line">
                      {side(item)}
                      {item.line}
                    </span>
                  </span>
                </span>
              </button>
              <Show when={props.onRemove}>
                <button
                  type="button"
                  class="prompt-review-chip-remove"
                  onClick={() => props.onRemove?.(item.id)}
                  aria-label={language.t("common.delete")}
                >
                  ×
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
