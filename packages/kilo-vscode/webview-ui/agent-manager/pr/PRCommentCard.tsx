/** @jsxImportSource solid-js */
import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { PRCommentDiff } from "../../diff-viewer/PRCommentDiff"
import { CopyButton } from "./CopyButton"
import { prMarkdown, preview } from "./pr-comment-payload"
import type { PRComment } from "./pr-types"

interface Props {
  comment: PRComment
  resolved: boolean
  pending: boolean
  sent: boolean
  open: boolean
  error?: string
  onToggleOpen: () => void
  onToggleResolved: () => void
  onSend: () => void
  onOpenFile?: () => void
  onOpenUrl?: () => void
}

export function PRCommentCard(props: Props) {
  const { t } = useLanguage()
  const location = () => {
    const file = props.comment.file
    if (!file) return ""
    return props.comment.line ? `${file}:${props.comment.line}` : file
  }

  return (
    <div class="am-pr-comment" classList={{ "am-pr-comment-open": props.open }}>
      <button
        type="button"
        class="am-pr-comment-head am-pr-row"
        aria-expanded={props.open}
        onClick={props.onToggleOpen}
      >
        <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="am-pr-comment-chevron" />
        <Show when={props.resolved}>
          <Icon name="circle-check" size="small" class="am-pr-comment-check" />
        </Show>
        <span class="am-pr-comment-author">{props.comment.author}</span>
        <Show when={props.open} fallback={<span class="am-pr-comment-preview">{preview(props.comment.body)}</span>}>
          <Show when={location()}>{(value) => <span class="am-pr-comment-file">{value()}</span>}</Show>
        </Show>
        <Show when={props.comment.outdated}>
          <span class="am-pr-comment-tag">{t("agentManager.pr.comment.outdated")}</span>
        </Show>
        <Show when={props.sent}>
          <span class="am-pr-comment-tag am-pr-comment-tag-sent">{t("agentManager.pr.comment.sent")}</span>
        </Show>
      </button>

      <Show when={props.open}>
        <Show when={props.comment.diffHunk && props.comment.file}>
          <PRCommentDiff file={props.comment.file!} hunk={props.comment.diffHunk!} />
        </Show>
        <div class="am-pr-comment-body">
          <Markdown text={props.comment.body} />
        </div>
        <For each={props.comment.replies}>
          {(reply) => (
            <div class="am-pr-comment-reply">
              <span class="am-pr-comment-author">{reply.author}</span>
              <div class="am-pr-comment-body">
                <Markdown text={reply.body} />
              </div>
            </div>
          )}
        </For>
        <Show when={props.error}>{(err) => <div class="am-pr-comment-error">{err()}</div>}</Show>
        <div class="am-pr-comment-actions am-pr-row">
          <Button variant="primary" size="small" disabled={props.sent} onClick={props.onSend}>
            {t("agentManager.pr.comment.send")}
          </Button>
          <Button
            variant="secondary"
            size="small"
            class="am-pr-comment-btn"
            disabled={props.pending}
            onClick={props.onToggleResolved}
          >
            <Show when={props.pending}>
              <Spinner class="am-pr-comment-spinner" />
            </Show>
            {props.resolved ? t("agentManager.pr.comment.unresolve") : t("agentManager.pr.comment.resolve")}
          </Button>
          <span class="am-pr-comment-actions-gap" />
          <CopyButton text={prMarkdown(props.comment)} label={t("agentManager.pr.comment.copy")} />
          <Show when={props.onOpenFile}>
            <Tooltip value={t("agentManager.diff.openFile")} placement="top">
              <IconButton
                icon="go-to-file"
                size="small"
                variant="ghost"
                label={t("agentManager.diff.openFile")}
                onClick={() => props.onOpenFile?.()}
              />
            </Tooltip>
          </Show>
          <Show when={props.onOpenUrl}>
            <Tooltip value={t("agentManager.pr.comment.openOnGitHub")} placement="top">
              <IconButton
                icon="square-arrow-top-right"
                size="small"
                variant="ghost"
                label={t("agentManager.pr.comment.openOnGitHub")}
                onClick={() => props.onOpenUrl?.()}
              />
            </Tooltip>
          </Show>
        </div>
      </Show>
    </div>
  )
}
