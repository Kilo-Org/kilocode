import { For, Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { isPRReviewComment } from "../../../../src/shared/review-comments"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ReviewCommentEntry } from "../../types/messages"
import { fileName } from "./prompt-input-utils"

interface ReviewCommentsProps {
  comments: ReviewCommentEntry[]
  sessionID?: string
  variant?: "draft" | "message"
  onRemove?: (id: string) => void
  onClear?: () => void
}

export const ReviewComments: Component<ReviewCommentsProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const author = (item: ReviewCommentEntry) => (isPRReviewComment(item) ? item.author : "")
  const side = (item: ReviewCommentEntry) => (isPRReviewComment(item) ? "" : item.side === "deletions" ? "-" : "+")
  const line = (item: ReviewCommentEntry) => (item.line ? `${side(item)}${item.line}` : "")
  const body = (item: ReviewCommentEntry) => (isPRReviewComment(item) ? item.body : item.comment)
  const snippet = (item: ReviewCommentEntry) => (isPRReviewComment(item) ? item.diffHunk : item.selectedText)
  const label = (item: ReviewCommentEntry) => (item.file ? fileName(item.file) : `@${author(item)}`)
  const title = (item: ReviewCommentEntry) => {
    const at = line(item)
    return at ? `${label(item)} ${at}` : label(item)
  }

  const open = (item: ReviewCommentEntry) => {
    if (!item.file) return
    const event = new CustomEvent("kilo:open-file", {
      cancelable: true,
      detail: { filePath: item.file, line: item.line, column: 1, sessionID: props.sessionID },
    })
    if (window.dispatchEvent(event))
      vscode.postMessage({
        type: "openFile",
        filePath: item.file,
        line: item.line,
        column: 1,
        sessionID: props.sessionID,
      })
    dialog.close()
  }

  const show = (item: ReviewCommentEntry) => {
    dialog.show(() => (
      <Dialog title={language.t("agentManager.review.modalTitle")} fit>
        <div class="prompt-review-modal">
          <div class="prompt-review-modal-head">
            <span class="prompt-review-modal-headline">{title(item)}</span>
            <Show when={item.file}>
              <Tooltip value={language.t("agentManager.diff.openFile")} placement="top">
                <IconButton
                  icon="go-to-file"
                  size="small"
                  variant="ghost"
                  label={language.t("agentManager.diff.openFile")}
                  onClick={() => open(item)}
                />
              </Tooltip>
            </Show>
          </div>

          <div class="prompt-review-modal-grid">
            <Show when={author(item)}>
              {(login) => (
                <>
                  <span class="prompt-review-modal-label">{language.t("agentManager.review.metaAuthor")}</span>
                  <span class="prompt-review-modal-value">@{login()}</span>
                </>
              )}
            </Show>
            <Show when={item.file}>
              {(file) => (
                <>
                  <span class="prompt-review-modal-label">{language.t("agentManager.review.metaFile")}</span>
                  <code class="prompt-review-modal-value">{file()}</code>
                </>
              )}
            </Show>
            <Show when={item.line}>
              {(value) => (
                <>
                  <span class="prompt-review-modal-label">{language.t("agentManager.review.metaLine")}</span>
                  <span class="prompt-review-modal-value">L{value()}</span>
                </>
              )}
            </Show>
            <span class="prompt-review-modal-label">{language.t("agentManager.review.metaComment")}</span>
            <span class="prompt-review-modal-value">
              <Show when={isPRReviewComment(item)} fallback={body(item)}>
                <Markdown text={body(item)} />
              </Show>
            </span>
          </div>

          <Show when={snippet(item)}>{(value) => <pre class="prompt-review-modal-snippet">{value()}</pre>}</Show>
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
              <button
                type="button"
                class="prompt-review-chip-body"
                onClick={() => (isPRReviewComment(item) ? show(item) : open(item))}
              >
                <span class="prompt-review-chip-icon">
                  <Icon name={isPRReviewComment(item) ? "github" : "comment"} size="small" />
                </span>
                <span class="prompt-review-chip-copy">
                  <span class="prompt-review-chip-main">
                    <span class="prompt-review-chip-title">{label(item)}</span>
                    <Show when={line(item)}>{(value) => <span class="prompt-review-chip-line">{value()}</span>}</Show>
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
