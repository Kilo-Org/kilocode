import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import type { HostedReview } from "@opencode/schema/kilocode/hosted-review"
import { useCodeComponent } from "@kilocode/kilo-ui/context/code"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { useLanguage } from "../../src/context/language"
import { FileTree } from "../../diff-viewer/FileTree"
import { VirtualDiffView } from "../../diff-viewer/VirtualDiffView"
import { reviewDraft, type ReviewDraft } from "./review-draft"
import { InlineReview, ReviewComments } from "./review-comments"
import type { ChatRoute } from "./route"
import type { DiffPreferences } from "./tool-diff"
import "./review.css"

type Props = { api: OpenCodeClient; route: ChatRoute; close: () => void; diffPreferences: DiffPreferences }
type Scope = NonNullable<HostedReview.Selection["scope"]> | "workspace"
const scopeOf = (e: HostedReview.Entry): Scope => e.scope ?? "workspace"

/** Scope the reader to one target, including cancellation and every byte of displayed file content. */
export function CloudReview(props: Props) {
  return (
    <Show when={props.route} keyed>
      {(route) => <Reader api={props.api} route={route} close={props.close} diffPreferences={props.diffPreferences} />}
    </Show>
  )
}

function Reader(props: Props) {
  const { t } = useLanguage()
  const rpc = props.api.rpc(KiloHostedRpc.Definition)
  const target = props.route.target
  const location = { directory: props.route.directory }
  const draft = reviewDraft(props.api, props.route)
  const [data, setData] = createSignal<HostedReview.Changes>()
  const [failure, setFailure] = createSignal(false)
  const [generation, reload] = createSignal({ refresh: false })
  const [scope, setScope] = createSignal<Scope>()
  const [path, setPath] = createSignal<string>()
  const scopes = createMemo(() => [...new Set(data()?.snapshot?.files.map(scopeOf))])
  const group = () => scopes().find((s) => s === scope()) ?? scopes()[0]
  const files = createMemo(() => data()?.snapshot?.files.filter((e) => scopeOf(e) === group()) ?? [])
  const selected = createMemo(() => files().find((e) => e.path === path()) ?? files()[0])
  createEffect(() => {
    const abort = new AbortController()
    const refresh = generation().refresh
    setFailure(false)
    setData(undefined)
    void rpc
      .reviewChanges({ target, refresh }, { location, signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted) setData(result)
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailure(true)
      })
    onCleanup(() => abort.abort())
  })
  const scopeText = (s: Scope) =>
    s === "workspace"
      ? t("agentManager.hoverCard.changes")
      : s === "uncommitted"
        ? t("session.tab.worktree")
        : t("diffViewer.source.workspace.label")
  return (
    <section class="am-cloud-review am-diff-panel" aria-label={t("agentManager.hoverCard.changes")}>
      <header class="am-diff-header">
        <div class="am-diff-header-main">
          <strong>{t("agentManager.hoverCard.changes")}</strong>
          <Show when={scopes().length > 1}>
            <select
              value={group()}
              aria-label={t("agentManager.hoverCard.changes")}
              onChange={(e) => setScope(scopes().find((s) => s === e.currentTarget.value))}
            >
              <For each={scopes()}>{(s) => <option value={s}>{scopeText(s)}</option>}</For>
            </select>
          </Show>
        </div>
        <div class="am-diff-header-actions">
          <IconButton
            icon="refresh"
            size="small"
            variant="ghost"
            label={t("common.refresh")}
            onClick={() => reload({ refresh: true })}
          />
          <IconButton icon="close" size="small" variant="ghost" label={t("common.close")} onClick={props.close} />
        </div>
      </header>
      <Show when={failure()}>
        <div class="am-diff-empty" role="alert">
          {t("common.requestFailed")}
        </div>
      </Show>
      <Show when={!failure() && !data()}>
        <div class="am-diff-loading" role="status">
          {t("session.review.loadingChanges")}
        </div>
      </Show>
      <Show when={data()}>
        {(result) => (
          <>
            <Show when={result().refresh === "offline" || result().refresh === "failed"}>
              <span class="am-cloud-review-note" role="status">
                {t("common.refresh")} · {t("provider.anaconda.status.unavailable")}
              </span>
            </Show>
            <Show
              when={result().snapshot}
              fallback={<div class="am-diff-empty">{t("prompt.mention.gitChangesUnavailable")}</div>}
            >
              {(snapshot) => (
                <>
                  <Show when={snapshot().truncated}>
                    <span class="am-cloud-review-note">
                      {t("agentManager.hoverCard.changes")} · {t("marketplace.status.incomplete")}
                    </span>
                  </Show>
                  <Show
                    when={files().length}
                    fallback={<div class="am-diff-empty">{t("session.review.noChanges")}</div>}
                  >
                    <div class="am-cloud-review-tree">
                      <FileTree
                        diffs={files().map((e) => ({ ...e, file: e.path, before: "", after: "" }))}
                        activeFile={selected()?.path ?? null}
                        onFileSelect={setPath}
                        showSummary={false}
                      />
                    </div>
                    <Show when={selected()} keyed>
                      {(entry) => (
                        <FilePreview
                          diffPreferences={props.diffPreferences}
                          entry={entry}
                          draft={draft}
                          comparison={snapshot().comparison}
                          load={(signal) =>
                            rpc.reviewFile(
                              { target, selection: { path: entry.path, scope: entry.scope, revision: entry.revision } },
                              { location, signal },
                            )
                          }
                          reload={() => reload({ refresh: false })}
                        />
                      )}
                    </Show>
                  </Show>
                </>
              )}
            </Show>
          </>
        )}
      </Show>
      <ReviewComments draft={draft} />
    </section>
  )
}

function FilePreview(props: {
  diffPreferences: DiffPreferences
  draft: ReviewDraft
  comparison?: HostedReview.Comment["comparison"]
  entry: HostedReview.Entry
  load: (signal: AbortSignal) => Promise<HostedReview.File>
  reload: () => void
}) {
  const { t } = useLanguage()
  const code = useCodeComponent()
  const [result, setResult] = createSignal<HostedReview.File>()
  const [error, fail] = createSignal(false)
  const [mode, setMode] = createSignal<"diff" | "source" | "comment">("diff")
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  void props
    .load(abort.signal)
    .then((value) => {
      if (abort.signal.aborted) return
      setResult(value)
      if (value.status === "omitted" && value.file.content.status === "available") setMode("source")
    })
    .catch(() => {
      if (!abort.signal.aborted) fail(true)
    })
  const file = createMemo(() => {
    const r = result()
    return r && "file" in r ? r.file : undefined
  })
  const patch = () => {
    const d = file()?.diff
    return d?.status === "available" ? d.patch : undefined
  }
  const text = () => {
    const c = file()?.content
    return c?.status === "available" ? c.text : undefined
  }
  return (
    <div class="am-cloud-review-file">
      <Show
        when={result() || error()}
        fallback={
          <div class="am-diff-loading" role="status">
            {t("session.review.loadingChanges")}
          </div>
        }
      >
        <Show
          when={file()}
          fallback={
            <div class="am-diff-empty" role="status">
              {t(error() ? "common.requestFailed" : "prompt.mention.gitChangesUnavailable")}{" "}
              <button onClick={props.reload}>{t("common.refresh")}</button>
            </div>
          }
        >
          <div class="am-review-toolbar">
            <RadioGroup
              options={
                patch() && file()?.patchHash && props.comparison && !props.entry.binary
                  ? (["diff", "source", "comment"] as const)
                  : (["diff", "source"] as const)
              }
              current={mode()}
              value={(s) => s}
              label={(s) =>
                t(
                  s === "diff"
                    ? "agentManager.hoverCard.changes"
                    : s === "comment"
                      ? "agentManager.pr.review.comment"
                      : "agentManager.documents.source",
                )
              }
              size="small"
              onSelect={(s) => s && setMode(s)}
            />
          </div>
          <Show
            when={mode() !== "comment"}
            fallback={
              <InlineReview
                entry={props.entry}
                patch={patch()!}
                patchHash={file()!.patchHash!}
                comparison={props.comparison!}
                draft={props.draft}
              />
            }
          >
            <Show
              when={mode() === "diff" ? patch() !== undefined : text() !== undefined}
              fallback={
                <div class="am-diff-empty">
                  {t(props.entry.binary ? "ui.fileMedia.binary.title" : "provider.anaconda.status.unavailable")}
                </div>
              }
            >
              <Show
                when={mode() === "diff"}
                fallback={
                  <div class="am-document-content">
                    <Dynamic
                      component={code}
                      file={{ name: props.entry.path, contents: text() ?? "" }}
                      class="am-document-code"
                    />
                  </div>
                }
              >
                <VirtualDiffView
                  diff={{
                    file: props.entry.path,
                    patch: patch(),
                    additions: props.entry.additions,
                    deletions: props.entry.deletions,
                    status: props.entry.status,
                  }}
                  diffStyle={props.diffPreferences.style()}
                  onDiffStyleChange={props.diffPreferences.updateStyle}
                  markdownRender={props.diffPreferences.markdown()}
                  onMarkdownRenderChange={props.diffPreferences.updateMarkdown}
                />
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
