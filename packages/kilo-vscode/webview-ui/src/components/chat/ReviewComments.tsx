import { For, Show, createMemo, createSignal, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { isPRReviewComment } from "../../../../src/shared/review-comments"
import { PRAvatar } from "../../../agent-manager/pr/PRAvatar"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ReviewCommentEntry } from "../../types/messages"
import { fileName } from "./prompt-input-utils"
import { openPRComment } from "../../utils/pr-review"

interface ReviewCommentsProps {
  comments: ReviewCommentEntry[]
  sessionID?: string
  variant?: "draft" | "message"
  onRemove?: (id: string) => void
  onClear?: (ids: string[]) => void
}

/** Rows rendered before the "show more" toggle takes over. */
const PREVIEW = 3
/** Rows after which the expanded list becomes internally scrollable. */
const SCROLL = 6

export const ReviewComments: Component<ReviewCommentsProps> = (props) => (
  <For each={["local", "pr"] as const}>
    {(source) => {
      const comments = createMemo(() => props.comments.filter((item) => isPRReviewComment(item) === (source === "pr")))
      return (
        <Show when={comments().length > 0}>
          <Group {...props} comments={comments()} source={source} />
        </Show>
      )
    }}
  </For>
)

function Group(props: ReviewCommentsProps & { source: "local" | "pr" }) {
  const language = useLanguage()
  const vscode = useVSCode()
  const [open, setOpen] = createSignal(true)
  const [all, setAll] = createSignal(false)
  const [full, setFull] = createSignal<string[]>([])

  const author = (item: ReviewCommentEntry) => (isPRReviewComment(item) ? item.author : "")
  const side = (item: ReviewCommentEntry) => (isPRReviewComment(item) ? "" : item.side === "deletions" ? "-" : "+")
  const line = (item: ReviewCommentEntry) => (item.line ? `${side(item)}${item.line}` : "")
  const body = (item: ReviewCommentEntry) => (isPRReviewComment(item) ? item.body : item.comment)
  const snippet = (item: ReviewCommentEntry) => (isPRReviewComment(item) ? item.diffHunk : item.selectedText)
  const label = (item: ReviewCommentEntry) => (item.file ? fileName(item.file) : `@${author(item)}`)
  const outdated = (item: ReviewCommentEntry) => isPRReviewComment(item) && item.outdated === true

  const files = createMemo(() => new Set(props.comments.filter((item) => item.file).map((item) => item.file)).size)
  // Collapsing a single extra row is not worth a toggle, so only hide from two up.
  const hidden = createMemo(() => (props.comments.length > PREVIEW + 1 ? props.comments.length - PREVIEW : 0))
  const rows = createMemo(() => (hidden() > 0 && !all() ? props.comments.slice(0, PREVIEW) : props.comments))

  const toggle = (id: string) =>
    setFull((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]))

  const reveal = (item: ReviewCommentEntry) => {
    if (!item.file) return
    // An outdated PR thread is anchored to a line that has since moved, so
    // jumping there lands on unrelated code. Open the file at the top instead.
    const at = outdated(item) || (isPRReviewComment(item) && item.side === "deletions") ? undefined : item.line
    const event = new CustomEvent("kilo:open-file", {
      cancelable: true,
      detail: { filePath: item.file, line: at, column: 1, sessionID: props.sessionID },
    })
    if (window.dispatchEvent(event))
      vscode.postMessage({
        type: "openFile",
        filePath: item.file,
        line: at,
        column: 1,
        sessionID: props.sessionID,
      })
  }

  return (
    <div
      class="prompt-review-comments"
      classList={{ "prompt-review-comments--message": props.variant === "message" }}
      data-component="review-comments"
      data-source={props.source}
    >
      <div class="prompt-review-comments-header">
        <button
          type="button"
          class="prompt-review-comments-toggle"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
          <Icon name={props.source === "pr" ? "github" : "comment"} size="small" />
          <span class="prompt-review-comments-title">
            {language.t(props.source === "pr" ? "agentManager.review.prCount" : "agentManager.review.inlineCount", {
              count: props.comments.length,
            })}
          </span>
          <Show when={files() > 1}>
            <span class="prompt-review-comments-meta">
              {language.t("agentManager.review.fileCount", { count: files() })}
            </span>
          </Show>
        </button>
        <Show when={props.onClear}>
          <Button variant="ghost" size="small" onClick={() => props.onClear?.(props.comments.map((item) => item.id))}>
            {language.t("agentManager.review.clearAll")}
          </Button>
        </Show>
      </div>

      <Show when={open()}>
        <div
          class="prompt-review-list"
          classList={{ "prompt-review-list--scroll": all() && props.comments.length > SCROLL }}
        >
          <For each={rows()}>
            {(item) => (
              <div class="prompt-review-row" classList={{ "prompt-review-row--full": full().includes(item.id) }}>
                <div class="prompt-review-row-top">
                  <span class="prompt-review-row-icon">
                    <Show when={isPRReviewComment(item) && item} fallback={<Icon name="comment" size="small" />}>
                      {(comment) => <PRAvatar author={comment().author} avatar={comment().avatar} />}
                    </Show>
                  </span>
                  <button
                    type="button"
                    class="prompt-review-row-main"
                    aria-expanded={full().includes(item.id)}
                    onClick={() => toggle(item.id)}
                  >
                    <span class="prompt-review-row-head">
                      <span class="prompt-review-row-label">{label(item)}</span>
                      <Show when={line(item)}>{(value) => <span class="prompt-review-row-line">{value()}</span>}</Show>
                      <Show when={item.file && author(item)}>
                        <span class="prompt-review-row-author">@{author(item)}</span>
                      </Show>
                      <Show when={outdated(item)}>
                        <span class="prompt-review-row-badge">{language.t("agentManager.pr.comment.outdated")}</span>
                      </Show>
                    </span>
                    <Show when={!full().includes(item.id)}>
                      <span class="prompt-review-row-preview">{body(item)}</span>
                    </Show>
                  </button>
                  <Show when={item.file && isPRReviewComment(item)}>
                    <Tooltip value={language.t("agentManager.pr.comment.showInDiff")} placement="top">
                      <IconButton
                        icon="code"
                        size="small"
                        variant="ghost"
                        aria-label={language.t("agentManager.pr.comment.showInDiff")}
                        onClick={() => {
                          if (isPRReviewComment(item)) openPRComment(vscode.postMessage, item, props.sessionID)
                        }}
                      />
                    </Tooltip>
                  </Show>
                  <Show when={item.file}>
                    <Tooltip value={language.t("agentManager.diff.openFile")} placement="top">
                      <IconButton
                        icon="go-to-file"
                        size="small"
                        variant="ghost"
                        aria-label={language.t("agentManager.diff.openFile")}
                        onClick={() => reveal(item)}
                      />
                    </Tooltip>
                  </Show>
                  <Show when={props.onRemove}>
                    <button
                      type="button"
                      class="prompt-review-row-remove"
                      onClick={() => props.onRemove?.(item.id)}
                      aria-label={language.t("common.delete")}
                    >
                      ×
                    </button>
                  </Show>
                </div>

                <Show when={full().includes(item.id)}>
                  <div class="prompt-review-row-detail">
                    <Show when={item.file}>{(file) => <code class="prompt-review-row-path">{file()}</code>}</Show>
                    <div class="prompt-review-row-text">
                      <Show when={isPRReviewComment(item)} fallback={body(item)}>
                        <Markdown text={body(item)} />
                      </Show>
                    </div>
                    <For each={isPRReviewComment(item) ? item.replies : undefined}>
                      {(reply) => (
                        <div class="prompt-review-row-reply">
                          <div class="prompt-review-row-head">
                            <PRAvatar author={reply.author} avatar={reply.avatar} />
                            <span class="prompt-review-row-author">@{reply.author}</span>
                          </div>
                          <div class="prompt-review-row-text">
                            <Markdown text={reply.body} />
                          </div>
                        </div>
                      )}
                    </For>
                    <Show when={snippet(item)}>
                      {(value) => <pre class="prompt-review-row-snippet">{value()}</pre>}
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        <Show when={hidden() > 0}>
          <button type="button" class="prompt-review-more" onClick={() => setAll(!all())}>
            {all()
              ? language.t("agentManager.review.showLess")
              : language.t("agentManager.review.showMore", { count: hidden() })}
          </button>
        </Show>
      </Show>
    </div>
  )
}
