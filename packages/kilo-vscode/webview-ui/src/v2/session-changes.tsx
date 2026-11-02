// Lists the files a session changed and opens them as native VS Code diffs. The diff covers the whole session: it
// asks the server for the oldest and the newest user message, because `session.diff` defaults to the newest turn and
// the client message cache only holds a page of messages.
import type { FileDiffInfo } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createEffect, createSignal, For, on, Show } from "solid-js"
import type { ToHost } from "../../../src/protocol"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import { useV2 } from "./client"
import { sessionDiffRange } from "./session-diff-range"

export function SessionChanges(props: { sessionID: string; onClose: () => void }) {
  const v2 = useV2()
  const vscode = useVSCode()
  const language = useLanguage()
  const [files, setFiles] = createSignal<FileDiffInfo[]>([])
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(true)

  const load = () => {
    const sessionID = props.sessionID
    setLoading(true)
    setError("")
    void Promise.all([
      v2.api.message.list({ sessionID, type: "user", order: "asc", limit: 1 }),
      v2.api.message.list({ sessionID, type: "user", order: "desc", limit: 1 }),
    ])
      .then(([oldest, newest]) => v2.api.session.diff({ sessionID, ...sessionDiffRange(oldest, newest) }))
      .then((data) => setFiles(data))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }

  createEffect(on(() => props.sessionID, load))
  // A running turn compares against the working copy, so refresh once it settles.
  createEffect(
    on(
      () => v2.data.session.status(props.sessionID),
      (status, previous) => {
        if (previous === "running" && status !== "running") load()
      },
    ),
  )

  const diff = (file: FileDiffInfo) => ({
    file: file.file,
    patch: file.patch,
    additions: file.additions,
    deletions: file.deletions,
  })
  const open = (file: FileDiffInfo) =>
    vscode.postMessage({ type: "openDiffVirtual", diff: diff(file) } satisfies ToHost as never)
  const openAll = () =>
    vscode.postMessage({ type: "openDiffsVirtual", diffs: files().map(diff) } satisfies ToHost as never)

  return (
    <div class="session-changes" data-component="session-changes">
      <div class="session-changes-header">
        <span class="session-changes-title">{language.t("sidebar.session.changes.title")}</span>
        <Show when={files().length}>
          <Button variant="secondary" size="small" onClick={openAll}>
            {language.t("sidebar.session.changes.openAll")}
          </Button>
        </Show>
        <IconButton
          icon="close"
          size="small"
          variant="ghost"
          onClick={props.onClose}
          aria-label={language.t("common.close")}
        />
      </div>
      <Show when={loading()}>
        <div class="session-changes-state" role="status">
          <Spinner />
          <span>{language.t("session.review.loadingChanges")}</span>
        </div>
      </Show>
      <Show when={!loading() && error()}>
        <div class="session-changes-state error-card" role="alert">
          {error()}
        </div>
      </Show>
      <Show when={!loading() && !error() && files().length === 0}>
        <div class="session-changes-state">{language.t("session.review.noChanges")}</div>
      </Show>
      <Show when={!loading() && !error() && files().length > 0}>
        <ul class="session-changes-list">
          <For each={files()}>
            {(file) => (
              <li>
                <button class="session-changes-file" onClick={() => open(file)} title={file.file}>
                  <span class="session-changes-path">{file.file}</span>
                  <span class="session-changes-count">
                    <span class="session-diff-add">+{file.additions}</span>
                    <span class="session-diff-del">-{file.deletions}</span>
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
