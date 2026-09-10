import { For, Show, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@kilocode/kilo-ui/button"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../src/context/language"
import { useVSCode } from "../../src/context/vscode"
import { PRCommentMarkdown } from "./PRCommentMarkdown"
import type { PRCommentRequest, PRTarget } from "../../../src/shared/pr-comment-actions"
import { reviewRequest } from "./pr-review-request"

interface Draft {
  body: string
  open: boolean
  pending?: string
  error?: string
  preview?: boolean
  destination?: "local" | "github"
  sent?: "reply" | "create" | "edit" | "delete" | "line" | "review"
  event?: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
}

type Props = {
  projectId?: string
  worktreeId: string
  /** Submit on plain Enter. Diff composers keep their existing Enter-to-send behavior. */
  submitOnEnter?: boolean
  /** Called when Escape is pressed in the editor. */
  onEscape?: () => void
  inline?: boolean
} & (
  | { action: "reply"; threadId: string }
  | { action: "create"; prNumber: number; prUrl: string }
  | {
      projectId?: string
      worktreeId: string
      action: "local"
      file: string
      side: "LEFT" | "RIGHT"
      startLine: number
      endLine: number
      selectedText: string
      initialBody?: string
      onBodyChange?: (body: string) => void
      onSubmit: (body: string, selectedText: string) => void
      onSend: (body: string, selectedText: string) => void
      onCancel: () => void
    }
  | {
      action: "diff"
      worktreeId: string
      projectId?: string
      file: string
      side: "LEFT" | "RIGHT"
      startLine: number
      endLine: number
      selectedText: string
      destination: "local" | "github"
      github?: {
        prNumber: number
        prUrl: string
        snapshotId: string
        label: string
        closed: boolean
      }
      initialBody?: string
      onBodyChange?: (body: string) => void
      onDestinationChange?: (value: "local" | "github") => void
      onSave: (body: string, selectedText: string) => void
      onSendKilo: (body: string, selectedText: string) => void
      onGithubSuccess: () => void
      onCancel: () => void
    }
  | (PRTarget & {
      action: "line"
      snapshotId: string
      path: string
      side: "LEFT" | "RIGHT"
      startLine: number
      endLine: number
      initialBody?: string
      onBodyChange?: (body: string) => void
      source?: string
      closed?: boolean
      onCancel: () => void
      onSuccess: () => void
    })
  | (PRTarget & {
      action: "review"
      snapshotId: string
      head: string
      own?: boolean
      closed?: boolean
      blocked?: boolean
      onSuccess: () => void
    })
  | {
      action: "edit"
      prNumber: number
      prUrl: string
      commentId: string
      body: string
      canEdit?: boolean
      canDelete?: boolean
      suggestion?: boolean
      published?: PRTarget
    }
)

// Keep drafts and in-flight replies across thread collapse and panel remounts.
const [drafts, setDrafts] = createStore<Record<string, Draft | undefined>>({})
const blank: Draft = { body: "", open: false }
const decisions = [
  { event: "COMMENT", action: "review-comment", label: "agentManager.pr.review.comment" },
  { event: "APPROVE", action: "review-approve", label: "agentManager.pr.review.approve" },
  { event: "REQUEST_CHANGES", action: "review-request-changes", label: "agentManager.pr.review.requestChanges" },
] as const

// The form supports local, inline, reply, edit, and review actions in one shared UI.
// eslint-disable-next-line complexity
export function PRCommentForm(props: Props) {
  const { t } = useLanguage()
  const vscode = useVSCode()
  let editor: HTMLInputElement | undefined
  // The discriminated union does not narrow inside JSX callbacks, so read the
  // diff-only fields through accessors that keep TypeScript happy.
  const github = () => (props.action === "diff" ? props.github : undefined)
  const key = createMemo(() =>
    JSON.stringify([
      props.projectId,
      props.worktreeId,
      props.action,
      props.action === "reply"
        ? props.threadId
        : props.action === "local" || props.action === "diff"
          ? props.file
          : props.prUrl,
      props.action === "edit" ? props.commentId : undefined,
      props.action === "local" || props.action === "diff"
        ? [props.file, props.side, props.startLine, props.endLine]
        : undefined,
      props.action === "diff" ? [props.github?.prNumber, props.github?.snapshotId] : undefined,
      props.action === "line" ? [props.snapshotId, props.path, props.side, props.startLine, props.endLine] : undefined,
      props.action === "review" ? [props.snapshotId, props.head] : undefined,
    ]),
  )
  const destination = () => {
    if (props.action !== "diff") return "local" as const
    return drafts[key()]?.destination ?? props.destination
  }
  const state = () =>
    drafts[key()] ??
    ((props.action === "line" || props.action === "local" || props.action === "diff") && props.initialBody
      ? { ...blank, body: props.initialBody }
      : blank)
  const [collapsed, setCollapsed] = createSignal<string>()
  const compact = () => props.action === "reply" || props.action === "create"
  const cancellable = () => props.action === "edit" || props.action === "local" || props.action === "diff" || compact()
  const expanded = () =>
    !!state().pending || state().open || (collapsed() !== key() && !!(state().body || state().error))
  const placeholder = () =>
    t(props.action === "reply" ? "agentManager.pr.comment.replyPlaceholder" : "agentManager.pr.comment.placeholder")
  const patch = (value: Partial<Draft>, id = key()) => setDrafts(id, (prev) => ({ ...(prev ?? blank), ...value }))
  const label = () =>
    props.action === "reply"
      ? t("agentManager.pr.comment.reply")
      : props.action === "review"
        ? t("agentManager.pr.review.summary")
        : props.action === "create" || props.action === "line" || props.action === "local" || props.action === "diff"
          ? t("agentManager.pr.comment.add")
          : t("common.edit")
  const ready = () =>
    !state().pending &&
    (props.action !== "line" || !props.closed) &&
    (props.action !== "review" ||
      (!props.closed && !props.blocked && (!props.own || !state().event || state().event === "COMMENT"))) &&
    (!!state().body.trim() || (props.action === "review" && state().event === "APPROVE"))
  const suggestion = () =>
    props.action === "reply" ||
    (props.action === "edit" && props.suggestion) ||
    (props.action === "line" && props.side === "RIGHT" && props.source !== undefined)
  const published = () =>
    props.action === "edit" && props.published ? { ...props.published, commentId: props.commentId } : undefined
  const own = () => props.action === "review" && props.own

  function suggest() {
    if (!editor || state().pending) return
    const body = editor.value
    const start = editor.selectionStart ?? body.length
    const end = editor.selectionEnd ?? start
    const code = props.action === "line" ? (props.source ?? "") : body.slice(start, end)
    const fence = "`".repeat(Math.max(3, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length + 1)))
    const before = body.slice(0, start)
    const after = body.slice(end)
    const prefix = `${before && !before.endsWith("\n") ? "\n" : ""}${fence}suggestion\n`
    const suffix = `${code.endsWith("\n") ? "" : "\n"}${fence}${after.startsWith("\n") ? "" : "\n"}`
    patch({ body: before + prefix + code + suffix + after, preview: false, sent: undefined })
    editor.focus()
    editor.setSelectionRange(start + prefix.length, start + prefix.length + code.length)
  }

  function open() {
    if (state().pending) return
    patch({
      open: true,
      sent: undefined,
      preview: false,
      ...(props.action === "edit" && (!drafts[key()] || state().sent) ? { body: props.body } : {}),
    })
    queueMicrotask(() => editor?.focus())
  }

  function cancel() {
    if (state().pending) return
    if (props.action === "local" || props.action === "diff") {
      patch({ body: "", error: undefined, preview: false, sent: undefined })
      props.onCancel()
      return
    }
    setCollapsed(key())
    patch({ open: false })
  }

  function sendKilo() {
    if (props.action !== "diff" || !ready()) return
    props.onSendKilo(state().body, props.selectedText)
    patch({ body: "", open: false, preview: false, sent: "line" })
  }

  function saveLocal() {
    if (props.action !== "diff" || !ready()) return
    props.onSave(state().body, props.selectedText)
    patch({ body: "", open: false, preview: false, sent: "line" })
  }

  function sendGithub() {
    const gh = github()
    if (props.action !== "diff" || !gh || gh.closed) return
    if (!ready()) return
    const requestId = crypto.randomUUID()
    const message: PRCommentRequest = {
      type: "agentManager.createReviewComment",
      projectId: props.projectId,
      worktreeId: props.worktreeId,
      prNumber: gh.prNumber,
      prUrl: gh.prUrl,
      requestId,
      snapshotId: gh.snapshotId,
      path: props.file,
      side: props.side,
      startLine: props.startLine,
      endLine: props.endLine,
      body: state().body,
    }
    patch({ pending: requestId, error: undefined, sent: undefined })
    reviewRequest(message, vscode.postMessage, (result) => {
      patch({ pending: undefined })
      if (result.success) {
        patch({ body: "", open: false, preview: false, sent: "line" })
        props.onGithubSuccess()
        return
      }
      patch({ error: result.error || "failed" })
    })
  }

  function sendPrimary() {
    if (destination() === "github") sendGithub()
    else sendKilo()
  }

  function submit(deleting = false) {
    if (props.action === "diff") return
    const body = state().body
    if (
      deleting
        ? props.action !== "edit" || !props.canDelete || !!state().pending || state().sent === "delete"
        : !ready()
    )
      return
    if (props.action === "local") {
      patch({ body: "", error: undefined, preview: false, sent: undefined })
      props.onSubmit(body, props.selectedText)
      return
    }
    const id = key()
    const requestId = crypto.randomUUID()
    const route = { projectId: props.projectId, worktreeId: props.worktreeId }
    const operation = deleting ? "delete" : props.action
    const message: PRCommentRequest = (() => {
      if (props.action === "reply")
        return { type: "agentManager.replyComment", ...route, threadId: props.threadId, body, requestId }
      const target = { ...route, prNumber: props.prNumber, prUrl: props.prUrl, requestId }
      if (props.action === "line")
        return {
          ...target,
          type: "agentManager.createReviewComment",
          snapshotId: props.snapshotId,
          path: props.path,
          side: props.side,
          startLine: props.startLine,
          endLine: props.endLine,
          body,
        }
      if (props.action === "review")
        return {
          ...target,
          type: "agentManager.submitPRReview",
          snapshotId: props.snapshotId,
          head: props.head,
          event: state().event ?? "COMMENT",
          body,
        }
      return {
        ...target,
        type: "agentManager.mutateComment",
        action: deleting ? "delete" : props.action,
        ...(props.action === "edit" ? { commentId: props.commentId } : {}),
        ...(operation === "delete" ? {} : { body }),
      }
    })()
    const success = props.action === "line" || props.action === "review" ? props.onSuccess : undefined
    patch({ pending: requestId, error: undefined, sent: undefined })
    reviewRequest(message, vscode.postMessage, (result) => {
      patch(
        result.success
          ? {
              body: "",
              open: false,
              preview: false,
              pending: undefined,
              sent: operation,
              event: undefined,
            }
          : { pending: undefined, error: result.error || t("common.requestFailed") },
        id,
      )
      if (result.success) success?.()
    })
  }

  return (
    <div class="am-pr-comment-composer" data-action={props.action} data-inline={props.inline || undefined}>
      <Show
        when={!compact() || expanded()}
        fallback={
          <Button
            data-action="expand"
            class="am-pr-comment-input"
            variant="secondary"
            aria-label={label()}
            aria-expanded={false}
            onFocus={() => open()}
            onClick={() => open()}
          >
            {state().body || placeholder()}
          </Button>
        }
      >
        <Show
          when={props.action !== "edit" || state().open}
          fallback={
            <Show when={state().sent !== "delete"}>
              <Show when={props.action === "edit"}>
                <div class="am-pr-comment-body">
                  <PRCommentMarkdown text={props.action === "edit" ? props.body : ""} published={published()} />
                </div>
              </Show>
              <div class="am-pr-row am-pr-comment-form-buttons">
                <Show when={props.action !== "edit" || props.canEdit}>
                  <Button
                    data-action="edit"
                    variant="secondary"
                    size="small"
                    disabled={!!state().pending}
                    onClick={() => open()}
                  >
                    {label()}
                  </Button>
                </Show>
                <Show when={props.action === "edit" && props.canDelete}>
                  <Button
                    data-action="delete"
                    variant="secondary"
                    size="small"
                    disabled={!!state().pending}
                    onClick={() => submit(true)}
                  >
                    <Show when={state().pending}>
                      <Spinner class="am-pr-comment-spinner" />
                    </Show>
                    {t("common.delete")}
                  </Button>
                </Show>
              </div>
            </Show>
          }
        >
          <div data-slot="comment-editor">
            <Show when={props.action === "review"}>
              <div
                class="am-pr-row am-pr-comment-form-buttons"
                role="group"
                aria-label={t("agentManager.pr.review.title")}
              >
                <For each={decisions}>
                  {(item) => (
                    <Button
                      size="small"
                      variant="secondary"
                      data-action={item.action}
                      aria-pressed={(state().event ?? "COMMENT") === item.event}
                      disabled={!!state().pending || (item.event !== "COMMENT" && own())}
                      onClick={() => patch({ event: item.event, sent: undefined })}
                    >
                      {t(item.label)}
                    </Button>
                  )}
                </For>
              </div>
              <Show when={own()}>
                <p>{t("agentManager.pr.review.own")}</p>
              </Show>
            </Show>
            <Show when={!props.inline}>
              <div data-slot="comment-toolbar">
                <Button
                  data-action="write"
                  variant="ghost"
                  size="small"
                  aria-pressed={!state().preview}
                  onClick={() => patch({ preview: false })}
                >
                  {t("agentManager.pr.comment.write")}
                </Button>
                <Button
                  data-action="preview"
                  variant="ghost"
                  size="small"
                  aria-pressed={!!state().preview}
                  onClick={() => patch({ preview: true })}
                >
                  {t("agentManager.pr.comment.preview")}
                </Button>
                <Show when={suggestion()}>
                  <span data-slot="comment-suggestion">
                    <Tooltip value={t("agentManager.pr.comment.suggestion")} placement="top">
                      <IconButton
                        data-action="suggestion"
                        icon="code"
                        variant="ghost"
                        size="small"
                        aria-label={t("agentManager.pr.comment.suggestion")}
                        disabled={!!state().pending || !!state().preview}
                        onClick={suggest}
                      />
                    </Tooltip>
                  </span>
                </Show>
              </div>
            </Show>
            <div hidden={!!state().preview}>
              <TextField
                ref={(node: HTMLInputElement) => {
                  editor = node
                }}
                multiline
                autoResize={!props.inline}
                label={label()}
                hideLabel
                placeholder={placeholder()}
                value={state().body}
                disabled={!!state().pending}
                onChange={(body) => {
                  patch({ body, sent: undefined })
                  if (props.action === "line" || props.action === "local" || props.action === "diff")
                    props.onBodyChange?.(body)
                }}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.isComposing || event.keyCode === 229) return
                  if (event.key === "Escape" && props.onEscape) {
                    event.preventDefault()
                    props.onEscape()
                    return
                  }
                  if (props.action === "diff") {
                    if (event.key !== "Enter" || event.shiftKey) return
                    // Cmd/Ctrl+Enter saves the comment. Plain Enter sends it to Kilo,
                    // and GitHub is never published from the keyboard.
                    if (event.ctrlKey || event.metaKey) {
                      event.preventDefault()
                      saveLocal()
                      return
                    }
                    if (destination() === "github") return
                    event.preventDefault()
                    sendKilo()
                    return
                  }
                  if (event.key !== "Enter") return
                  if (event.ctrlKey || event.metaKey) {
                    event.preventDefault()
                    submit()
                    return
                  }
                  if (props.submitOnEnter && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
            </div>
            <Show when={state().preview}>
              <div data-slot="comment-preview">
                <Show when={state().body.trim()} fallback={t("agentManager.pr.comment.previewEmpty")}>
                  <PRCommentMarkdown text={state().body} />
                </Show>
              </div>
            </Show>
            <Show when={props.action === "diff"}>
              <div class="am-pr-comment-actions am-pr-row" data-slot="comment-actions">
                <Button data-action="save" variant="secondary" size="small" disabled={!ready()} onClick={saveLocal}>
                  {t("common.save")}
                </Button>
                <Button
                  data-action="cancel"
                  variant="secondary"
                  size="small"
                  disabled={!!state().pending}
                  onClick={cancel}
                >
                  {t("common.cancel")}
                </Button>
                <span data-slot="comment-actions-gap" />
                <Button
                  data-action={state().preview ? "write" : "preview"}
                  variant="ghost"
                  size="small"
                  aria-pressed={!!state().preview}
                  onClick={() => {
                    patch({ preview: !state().preview })
                    if (!state().preview) editor?.focus()
                  }}
                >
                  {t(state().preview ? "agentManager.pr.comment.write" : "agentManager.pr.comment.preview")}
                </Button>
                <Show
                  when={github()}
                  fallback={
                    <Button
                      data-action="send-kilo"
                      variant="primary"
                      size="small"
                      disabled={!ready()}
                      onClick={sendKilo}
                    >
                      {t("diffViewer.comment.sendToKilo")}
                    </Button>
                  }
                >
                  {(pr) => (
                    <div class="am-split-button" data-variant="primary" data-disabled={!ready() ? "" : undefined}>
                      <Button
                        data-action="send-primary"
                        data-destination={destination()}
                        variant="primary"
                        size="small"
                        disabled={!ready() || (destination() === "github" && pr().closed)}
                        aria-busy={!!state().pending}
                        onClick={sendPrimary}
                      >
                        <Show when={state().pending}>
                          <Spinner class="am-pr-comment-spinner" />
                        </Show>
                        {destination() === "github"
                          ? t("diffViewer.comment.sendToGithub", { number: pr().prNumber })
                          : t("diffViewer.comment.sendToKilo")}
                      </Button>
                      <DropdownMenu gutter={4} placement="bottom-end">
                        <DropdownMenu.Trigger
                          class="am-split-arrow"
                          disabled={!!state().pending}
                          aria-label={t("diffViewer.comment.chooseDestination")}
                        >
                          <Icon name="chevron-down" size="small" />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content class="am-split-menu">
                            <DropdownMenu.Item
                              onSelect={() => {
                                if (props.action !== "diff") return
                                patch({ destination: "local" })
                                props.onDestinationChange?.("local")
                              }}
                            >
                              <span class="am-menu-check" aria-hidden="true">
                                <Show when={destination() !== "github"}>
                                  <Icon name="check" size="small" />
                                </Show>
                              </span>
                              <DropdownMenu.ItemLabel>{t("diffViewer.comment.sendToKilo")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              disabled={pr().closed}
                              onSelect={() => {
                                if (props.action !== "diff") return
                                patch({ destination: "github" })
                                props.onDestinationChange?.("github")
                              }}
                            >
                              <span class="am-menu-check" aria-hidden="true">
                                <Show when={destination() === "github"}>
                                  <Icon name="check" size="small" />
                                </Show>
                              </span>
                              <DropdownMenu.ItemLabel>
                                {t("diffViewer.comment.sendToGithub", { number: pr().prNumber })}
                              </DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </div>
                  )}
                </Show>
              </div>
              <Show when={destination() === "github" && github()?.closed}>
                <div class="am-pr-comment-error" role="status">
                  {t("diffViewer.comment.unavailable")}
                </div>
              </Show>
            </Show>
            <Show when={props.action !== "diff"}>
              <div class="am-pr-comment-actions am-pr-row">
                <Show when={props.inline}>
                  <Button
                    data-action={state().preview ? "write" : "preview"}
                    variant="ghost"
                    size="small"
                    aria-pressed={!!state().preview}
                    onClick={() => {
                      patch({ preview: !state().preview })
                      if (!state().preview) editor?.focus()
                    }}
                  >
                    {t(state().preview ? "agentManager.pr.comment.write" : "agentManager.pr.comment.preview")}
                  </Button>
                  <span data-slot="comment-actions-gap" />
                </Show>
                <Button
                  data-action="submit"
                  variant={props.inline && props.action === "local" ? "secondary" : "primary"}
                  size="small"
                  disabled={!ready()}
                  onClick={() => submit()}
                >
                  <Show when={state().pending}>
                    <Spinner class="am-pr-comment-spinner" />
                  </Show>
                  {state().pending
                    ? t("agentManager.pr.comment.replySending")
                    : props.inline && props.action === "line"
                      ? t("diffViewer.comment.postToGithub")
                      : props.inline && props.action === "local"
                        ? t("diffViewer.comment.saveLocal")
                        : props.action === "reply"
                          ? t("agentManager.pr.comment.reply")
                          : props.action === "review"
                            ? t("agentManager.pr.review.title")
                            : props.action === "create" || props.action === "line" || props.action === "local"
                              ? t("agentManager.pr.comment.addSubmit")
                              : t("common.save")}
                </Button>
                <Show when={props.action === "local"}>
                  <Button
                    data-action="send"
                    aria-label={t("diffViewer.comment.sendToAgent")}
                    title={t("diffViewer.comment.sendToAgent")}
                    variant="primary"
                    size="small"
                    disabled={!ready()}
                    onClick={() => {
                      if (props.action !== "local") return
                      props.onSend(state().body, props.selectedText)
                    }}
                  >
                    {t("prompt.action.send")}
                  </Button>
                </Show>
                <Show when={cancellable()}>
                  <Button
                    data-action="cancel"
                    variant="secondary"
                    size="small"
                    disabled={!!state().pending}
                    onClick={cancel}
                  >
                    {t("common.cancel")}
                  </Button>
                </Show>
                <Show when={props.action === "line"}>
                  <Button
                    data-action="discard"
                    variant="secondary"
                    size="small"
                    disabled={!!state().pending}
                    onClick={() => {
                      patch({ body: "", error: undefined, preview: false, sent: undefined })
                      if (props.action === "line") props.onCancel()
                    }}
                  >
                    {t(props.inline ? "common.cancel" : "agentManager.pr.review.discard")}
                  </Button>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
      <Show when={props.inline && props.action === "line" && props.closed}>
        <div class="am-pr-comment-error" role="status">
          {t("diffViewer.comment.unavailable")}
        </div>
      </Show>
      <Show when={(!compact() || expanded()) && state().error}>
        {(error) => (
          <div class="am-pr-comment-error" role="alert">
            {t(
              props.action === "reply" ? "agentManager.pr.comment.replyFailed" : "agentManager.pr.comment.actionFailed",
              { error: error() },
            )}
          </div>
        )}
      </Show>
      <Show when={state().sent}>
        <span role="status">
          {t(
            state().sent === "review"
              ? "agentManager.pr.review.submitted"
              : state().sent === "reply"
                ? "agentManager.pr.comment.replySent"
                : state().sent === "create" || state().sent === "line"
                  ? "agentManager.pr.comment.added"
                  : state().sent === "delete"
                    ? "agentManager.pr.comment.deleted"
                    : "agentManager.pr.comment.updated",
          )}
        </span>
      </Show>
    </div>
  )
}
