import { For, Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useWorktreeMode } from "../../context/worktree-mode"
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
  const worktree = useWorktreeMode()
  const dialog = useDialog()
  const side = (item: ReviewComment) => (item.side === "deletions" ? "-" : "+")
  const title = (item: ReviewComment) => `${fileName(item.file)} ${side(item)}${item.line}`

  const open = (item: ReviewComment) => {
    if (worktree && props.sessionID) {
      vscode.postMessage({
        type: "agentManager.openFile",
        sessionId: props.sessionID,
        filePath: item.file,
        line: item.line,
      })
      dialog.close()
      return
    }
    vscode.postMessage({ type: "openFile", filePath: item.file, line: item.line, column: 1 })
    dialog.close()
  }

  const show = (item: ReviewComment) => {
    dialog.show(() => (
      <Dialog title={language.t("agentManager.review.modalTitle")} fit>
        <div class="prompt-review-modal">
          <div class="prompt-review-modal-head">
            <span class="prompt-review-modal-headline">{title(item)}</span>
            <Tooltip value={language.t("agentManager.diff.openFile")} placement="top">
              <IconButton
                icon="go-to-file"
                size="small"
                variant="ghost"
                label={language.t("agentManager.diff.openFile")}
                onClick={() => open(item)}
              />
            </Tooltip>
          </div>

          <div class="prompt-review-modal-grid">
            <span class="prompt-review-modal-label">{language.t("agentManager.review.metaFile")}</span>
            <code class="prompt-review-modal-value">{item.file}</code>
            <span class="prompt-review-modal-label">{language.t("agentManager.review.metaLine")}</span>
            <span class="prompt-review-modal-value">L{item.line}</span>
            <span class="prompt-review-modal-label">{language.t("agentManager.review.metaComment")}</span>
            <span class="prompt-review-modal-value">{item.comment}</span>
          </div>

          <Show when={item.selectedText}>
            <pre class="prompt-review-modal-snippet">{item.selectedText}</pre>
          </Show>
        </div>
      </Dialog>
    ))
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
              <button type="button" class="prompt-review-chip-body" onClick={() => show(item)}>
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
