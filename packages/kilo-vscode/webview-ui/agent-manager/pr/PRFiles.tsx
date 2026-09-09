import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { normalizeHunk } from "@kilocode/kilo-ui/session-diff"
import type { SelectedLineRange } from "@pierre/diffs"
import type { PRDiffSnapshot, PRTarget } from "../../../src/shared/pr-comment-actions"
import { parsePatch } from "../../../src/shared/pr-patch"
import { useLanguage } from "../../src/context/language"
import { useVSCode } from "../../src/context/vscode"
import { PRCommentForm } from "./PRCommentForm"
import { reviewRequest } from "./pr-review-request"

type Anchor = { path: string; side: "LEFT" | "RIGHT"; startLine: number; endLine: number; source?: string }
type State = { snapshot?: PRDiffSnapshot; pending?: boolean; error?: string; file?: string; anchor?: Anchor }
const MAX_ROUTES = 4
const [states, setStates] = createSignal(new Map<string, State>())
const virtualized = typeof Document !== "undefined" && typeof globalThis.innerHeight === "number"

function trim(next: Map<string, State>, active: string) {
  if (next.size <= MAX_ROUTES) return
  for (const [id, value] of next) {
    if (next.size <= MAX_ROUTES) return
    if (id === active || value.pending) continue
    next.delete(id)
  }
}

export function PRFiles(props: PRTarget & { own?: boolean; closed?: boolean; onRefresh: () => void }) {
  const { t } = useLanguage()
  const vscode = useVSCode()
  let composer: HTMLDivElement | undefined
  const key = () => JSON.stringify([props.projectId, props.worktreeId, props.prNumber, props.prUrl])
  const state = () => states().get(key()) ?? {}
  const drop = (id: string) =>
    setStates((prev) => {
      const value = prev.get(id)
      if (!value) return prev
      const next = new Map(prev)
      if (value.pending) {
        next.set(id, { pending: true })
        return next
      }
      next.delete(id)
      return next
    })
  const patch = (value: Partial<State>, id = key()) =>
    setStates((prev) => {
      if (id !== key() && !prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      next.set(id, { ...prev.get(id), ...value })
      trim(next, key())
      return next
    })
  createEffect(
    on(key, (id, previous) => {
      if (previous && previous !== id) drop(previous)
    }),
  )
  const target = (): PRTarget => ({
    projectId: props.projectId,
    worktreeId: props.worktreeId,
    prNumber: props.prNumber,
    prUrl: props.prUrl,
  })
  const file = createMemo(() => state().snapshot?.files.find((file) => file.path === state().file))
  const view = createMemo(() => {
    const item = file()
    if (!item?.patch || !parsePatch(item.patch)) return
    return normalizeHunk(item.path, item.patch)
  })
  function load() {
    if (state().pending || state().anchor) return
    const id = key()
    patch({ pending: true, error: undefined })
    reviewRequest(
      { ...target(), type: "agentManager.loadPRFiles", requestId: crypto.randomUUID() },
      vscode.postMessage,
      (result) => {
        if (result.type !== "agentManager.loadPRFilesResult") return
        patch(
          result.success && result.snapshot
            ? { pending: false, snapshot: result.snapshot, file: result.snapshot.files.at(0)?.path }
            : { pending: false, error: result.error || t("common.requestFailed") },
          id,
        )
        if (id !== key()) drop(id)
      },
    )
  }
  function select(range: SelectedLineRange | null) {
    if (!range || state().pending || state().anchor || props.closed || !view() || !file()) return
    if (range.side !== "additions" && range.side !== "deletions") return
    if (range.endSide && range.endSide !== range.side) return
    const side = range.side === "deletions" ? "LEFT" : "RIGHT"
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    const selected = parsePatch(file()!.patch!, undefined, { side, start, end })?.source
    if (selected === undefined) return
    patch({
      anchor: {
        path: file()!.path,
        side,
        startLine: start,
        endLine: end,
        source: side === "RIGHT" ? selected : undefined,
      },
    })
    requestAnimationFrame(() => {
      if (!composer?.isConnected) return
      composer.scrollIntoView({ block: "nearest" })
      composer.querySelector("textarea")?.focus({ preventScroll: true })
    })
  }
  return (
    <section class="am-pr-review" data-component="pr-files">
      <h3>{t("agentManager.pr.review.files")}</h3>
      <Show when={state().snapshot}>
        <p>{t("agentManager.pr.review.reloadNote")}</p>
      </Show>
      <Button
        data-action="load-files"
        variant="secondary"
        size="small"
        disabled={state().pending || !!state().anchor}
        onClick={load}
      >
        <Show when={state().pending}>
          <Spinner />
        </Show>
        {t(state().snapshot ? "agentManager.pr.review.reload" : "agentManager.pr.review.load")}
      </Button>
      <Show when={state().error}>
        <div role="alert" class="am-pr-comment-error">
          {state().error}
        </div>
      </Show>
      <Show when={state().snapshot}>
        {(snapshot) => (
          <>
            <p data-slot="review-head">{t("agentManager.pr.review.head", { head: snapshot().head })}</p>
            <div class="am-pr-review-files" role="group" aria-label={t("agentManager.pr.review.files")}>
              <For each={snapshot().files}>
                {(item) => (
                  <Button
                    size="small"
                    variant="ghost"
                    data-path={item.path}
                    aria-pressed={state().file === item.path}
                    onClick={() => patch({ file: item.path })}
                  >
                    {item.path}
                  </Button>
                )}
              </For>
            </div>
            <p>{t("agentManager.pr.review.select")}</p>
            <Show when={view()} fallback={<p>{t("agentManager.pr.review.unavailable")}</p>}>
              {(value) => (
                <div class="am-pr-diff-hunk" data-slot="review-file-diff">
                  <Diff
                    fileDiff={value().fileDiff}
                    diffStyle="unified"
                    hunkSeparators="simple"
                    virtualized={virtualized}
                    disableLineNumbers={false}
                    enableLineSelection={!props.closed && !state().pending}
                    onLineSelectionEnd={select}
                    onGutterUtilityClick={select}
                  />
                </div>
              )}
            </Show>
            <Show when={state().anchor}>
              {(anchor) => (
                <div ref={composer} data-slot="line-comment">
                  <p>
                    {t("agentManager.pr.review.anchor", {
                      path: anchor().path,
                      side: t(
                        anchor().side === "LEFT" ? "agentManager.pr.review.left" : "agentManager.pr.review.right",
                      ),
                      start: anchor().startLine,
                      end: anchor().endLine,
                    })}
                  </p>
                  <p>{t("agentManager.pr.review.keepDraft")}</p>
                  <PRCommentForm
                    {...target()}
                    {...anchor()}
                    action="line"
                    snapshotId={snapshot().id}
                    closed={props.closed}
                    onCancel={() => patch({ anchor: undefined })}
                    onSuccess={(() => {
                      const id = key()
                      const refresh = props.onRefresh
                      return () => {
                        patch({ anchor: undefined }, id)
                        refresh()
                      }
                    })()}
                  />
                </div>
              )}
            </Show>
            <Show when={!props.closed} fallback={<p>{t("agentManager.pr.review.closed")}</p>}>
              <h3>{t("agentManager.pr.review.title")}</h3>
              <PRCommentForm
                {...target()}
                action="review"
                snapshotId={snapshot().id}
                blocked={!!state().anchor || !!state().pending}
                head={snapshot().head}
                own={props.own}
                closed={props.closed}
                onSuccess={props.onRefresh}
              />
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}
