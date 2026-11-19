import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { SelectedLineRange } from "@pierre/diffs"
import { Button } from "@kilocode/kilo-ui/button"
import { Diff } from "@kilocode/kilo-ui/diff"
import { normalizeHunk } from "@kilocode/kilo-ui/session-diff"
import type { HostedReview } from "@opencode/schema/kilocode/hosted-review"
import { useLanguage } from "../../src/context/language"
import type { ReviewDraft } from "./review-draft"

export function InlineReview(props: {
  entry: HostedReview.Entry
  patch: string
  patchHash: string
  comparison: HostedReview.Comment["comparison"]
  draft: ReviewDraft
}) {
  const { t } = useLanguage()
  const view = createMemo(() => normalizeHunk(props.entry.path, props.patch))
  const [anchor, setAnchor] = createSignal<Pick<HostedReview.Comment, "side" | "start" | "end">>(),
    [text, setText] = createSignal("")
  function select(r: SelectedLineRange | null) {
    if (
      !r ||
      !r.side ||
      (r.endSide && r.side !== r.endSide) ||
      props.draft.locked() ||
      text().trim() ||
      Math.abs(r.start - r.end) >= 100
    )
      return
    setAnchor({ side: r.side, start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) })
  }
  function save() {
    const range = anchor(),
      comments = props.draft.state().comments
    if (!range || !text().trim() || comments.length >= 50 || props.draft.locked()) return
    props.draft.edit({
      comments: [
        ...comments,
        {
          id: crypto.randomUUID(),
          scope: props.entry.scope,
          path: props.entry.path,
          revision: props.entry.revision,
          comparison: props.comparison,
          patchHash: props.patchHash,
          ...range,
          text: text().trim(),
        },
      ],
    })
    setAnchor(undefined)
    setText("")
  }
  return (
    <div class="am-cloud-review-lines">
      <p>{t("agentManager.pr.review.select")}</p>
      <Show when={view()}>
        {(v) => (
          <Diff
            fileDiff={v().fileDiff}
            diffStyle="unified"
            hunkSeparators="simple"
            virtualized
            disableLineNumbers={false}
            enableLineSelection={!props.draft.locked()}
            onLineSelectionEnd={select}
            onGutterUtilityClick={select}
          />
        )}
      </Show>
      <Show when={anchor()}>
        {(a) => (
          <div class="am-cloud-review-editor">
            <label>
              {t("agentManager.pr.review.anchor", {
                path: props.entry.path,
                side: t(a().side === "deletions" ? "agentManager.pr.review.left" : "agentManager.pr.review.right"),
                start: a().start,
                end: a().end,
              })}
              <textarea
                maxlength={4000}
                placeholder={t("agentManager.review.commentPlaceholder")}
                value={text()}
                onInput={(e) => setText(e.currentTarget.value)}
              />
            </label>
            <Button
              size="small"
              variant="primary"
              disabled={!text().trim() || props.draft.locked() || props.draft.state().comments.length >= 50}
              onClick={save}
            >
              {t("agentManager.review.commentAction")}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setAnchor(undefined)
                setText("")
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        )}
      </Show>
    </div>
  )
}

export function ReviewComments(props: { draft: ReviewDraft }) {
  const { t } = useLanguage(),
    d = props.draft
  const has = createMemo(() => d.state().comments.length > 0)
  createEffect(() => {
    if (has()) void Promise.resolve().then(d.load)
  })
  return (
    <Show when={has() || d.state().status === "accepted"}>
      <section class="am-cloud-review-draft" aria-label={t("agentManager.pr.review.title")}>
        <Show when={has()}>
          <strong>{t("agentManager.pr.review.title")}</strong>
          <For each={d.state().comments.map((c) => c.id)}>
            {(id) => {
              const c = () => d.state().comments.find((row) => row.id === id)!
              return (
                <div class="am-cloud-review-editor">
                  <label>
                    {t("agentManager.pr.review.anchor", {
                      path: c().path,
                      side: t(
                        c().side === "deletions" ? "agentManager.pr.review.left" : "agentManager.pr.review.right",
                      ),
                      start: c().start,
                      end: c().end,
                    })}
                    <textarea
                      disabled={d.locked()}
                      maxlength={4000}
                      value={c().text}
                      onInput={(e) =>
                        d.edit({
                          comments: d
                            .state()
                            .comments.map((row) => (row.id === id ? { ...row, text: e.currentTarget.value } : row)),
                        })
                      }
                    />
                  </label>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={d.locked()}
                    onClick={() => d.edit({ comments: d.state().comments.filter((row) => row.id !== id) })}
                  >
                    {t("agentManager.pr.review.discard")}
                  </Button>
                </div>
              )
            }}
          </For>
          <label>
            {t("agentManager.pr.review.summary")}
            <textarea
              disabled={d.locked()}
              maxlength={4000}
              value={d.state().overall}
              onInput={(e) => d.edit({ overall: e.currentTarget.value })}
            />
          </label>
          <label>
            {t("diffViewer.comment.chooseDestination")}
            <select
              disabled={d.locked()}
              value={d.state().destinationID}
              onChange={(e) => d.edit({ destinationID: e.currentTarget.value })}
            >
              <option value="">{t("diffViewer.comment.chooseDestination")}</option>
              <For each={d.choices()}>
                {(c) => (
                  <option value={c.sessionID} selected={c.sessionID === d.state().destinationID}>
                    {c.title}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Show when={d.failed() || (!d.loading() && !d.choices().length)}>
            <div role="status">
              {t(d.failed() ? "common.requestFailed" : "provider.anaconda.status.unavailable")}{" "}
              <Button size="small" variant="ghost" onClick={() => void d.load()}>
                {t("common.refresh")}
              </Button>
            </div>
          </Show>
          <p>{t("agentManager.cloud.review.autoCommit")}</p>
          <Button
            size="small"
            variant="primary"
            disabled={
              d.busy() ||
              (!d.state().messageID &&
                (!d.choices().some((c) => c.sessionID === d.state().destinationID) ||
                  d.state().comments.some((c) => !c.text.trim())))
            }
            onClick={() => void d.dispatch()}
          >
            {t(d.state().messageID ? "common.refresh" : "agentManager.review.sendAllToChatWithCount", {
              count: d.state().comments.length,
            })}
          </Button>
        </Show>
        <Show when={d.state().status}>
          <div role="status">
            {t(
              d.busy()
                ? "common.loading"
                : d.state().status === "accepted"
                  ? "agentManager.pr.review.submitted"
                  : d.state().status === "unverified"
                    ? "agentManager.worktree.stale"
                    : d.state().status === "unknown"
                      ? "agentManager.orphans.sizeUnknown"
                      : "common.requestFailed",
            )}
          </div>
        </Show>
      </section>
    </Show>
  )
}
