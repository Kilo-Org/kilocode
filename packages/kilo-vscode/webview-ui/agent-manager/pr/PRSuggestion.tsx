import { Show, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { normalizeHunk } from "@kilocode/kilo-ui/session-diff"
import type { PRSuggestionPreview, PRTarget } from "../../../src/shared/pr-comment-actions"
import { useLanguage } from "../../src/context/language"
import { useVSCode } from "../../src/context/vscode"
import { reviewRequest } from "./pr-review-request"

type State = { preview?: PRSuggestionPreview; pending?: boolean; error?: string; applied?: boolean }
const [states, setStates] = createSignal<Record<string, State>>({})

export function PRSuggestion(props: PRTarget & { commentId: string; suggestion: number }) {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const key = () =>
    JSON.stringify([props.projectId, props.worktreeId, props.prNumber, props.prUrl, props.commentId, props.suggestion])
  const state = () => states()[key()] ?? {}
  const patch = (value: Partial<State>, id = key()) =>
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...value } }))
  const diff = createMemo(() => {
    const preview = state().preview
    return preview ? normalizeHunk(preview.path, preview.patch) : undefined
  })
  function send(apply: boolean) {
    if (state().pending || state().applied || (apply && !state().preview)) return
    const id = key()
    const target = {
      projectId: props.projectId,
      worktreeId: props.worktreeId,
      prNumber: props.prNumber,
      prUrl: props.prUrl,
      requestId: crypto.randomUUID(),
    }
    const message = apply
      ? { ...target, type: "agentManager.applyPRSuggestion" as const, token: state().preview!.token }
      : {
          ...target,
          type: "agentManager.previewPRSuggestion" as const,
          commentId: props.commentId,
          suggestion: props.suggestion,
        }
    patch({ pending: true, error: undefined })
    reviewRequest(message, vscode.postMessage, (result) => {
      if (!result.success) {
        patch(
          {
            pending: false,
            error: result.error || t("common.requestFailed"),
            ...(apply ? { preview: undefined } : {}),
          },
          id,
        )
        return
      }
      if (result.type === "agentManager.previewPRSuggestionResult" && result.preview) {
        patch({ pending: false, preview: result.preview }, id)
        return
      }
      if (result.type === "agentManager.applyPRSuggestionResult") {
        patch({ pending: false, preview: undefined, applied: true }, id)
        return
      }
      patch({ pending: false, error: t("common.requestFailed") }, id)
    })
  }
  return (
    <div data-component="pr-suggestion">
      <Show when={!state().applied} fallback={<p role="status">{t("agentManager.pr.review.applied")}</p>}>
        <Show when={!state().preview}>
          <Button
            data-action="preview-suggestion"
            size="small"
            variant="secondary"
            disabled={state().pending}
            onClick={() => send(false)}
          >
            {t("agentManager.pr.review.preview")}
          </Button>
        </Show>
        <Show when={state().pending}>
          <Spinner />
        </Show>
        <Show when={state().preview}>
          {(preview) => (
            <>
              <p>{preview().path}</p>
              <Show when={diff()} fallback={<p>{t("agentManager.pr.review.unavailable")}</p>}>
                {(value) => (
                  <div class="am-pr-diff-hunk">
                    <Diff fileDiff={value().fileDiff} diffStyle="unified" virtualized={false} hunkSeparators="simple" />
                  </div>
                )}
              </Show>
              <p>{t("agentManager.pr.review.noPush")}</p>
              <div class="am-pr-row am-pr-comment-form-buttons">
                <Button
                  data-action="apply-suggestion"
                  size="small"
                  variant="primary"
                  disabled={state().pending || !diff()}
                  onClick={() => send(true)}
                >
                  {t("agentManager.pr.review.apply")}
                </Button>
                <Button
                  data-action="cancel-suggestion"
                  size="small"
                  variant="secondary"
                  disabled={state().pending}
                  onClick={() => patch({ preview: undefined, error: undefined })}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          )}
        </Show>
      </Show>
      <Show when={state().error}>
        <div class="am-pr-comment-error" role="alert">
          {state().error}
        </div>
      </Show>
    </div>
  )
}
