import { createSignal, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import type { SessionMessageInfo } from "@opencode/client"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { useLanguage } from "../../src/context/language"
import { TranscriptRowView } from "../../src/v2/transcript-row"
import { transcriptRows } from "../../src/v2/transcript"
import { TranscriptLoading } from "../../src/v2/transcript-loading"
import type { HostedChatModel } from "../hosted-chat-model"
import type { CloudDiffActions } from "./tool-diff"

/** A scoped, read-only child transcript. Nested tasks stay under their original root. */
export function CloudChild(props: {
  chat: HostedChatModel
  diffActions?: CloudDiffActions
  openLink: (uri: string) => void
  id: string
  title?: string
  back: () => void
  open: (id: string, title?: string) => void
}) {
  const { t } = useLanguage()
  const life = new AbortController()
  onCleanup(() => life.abort())
  const [messages, setMessages] = createSignal<readonly KiloHostedRpc.Message[]>([])
  const [before, setBefore] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const rows = createMemo(() => transcriptRows(messages() as readonly SessionMessageInfo[]))
  async function load(cursor?: string) {
    if (busy()) return
    setBusy(true)
    setFailed(false)
    try {
      const page = await props.chat.childHistory(props.id, life.signal, cursor)
      if (life.signal.aborted) return
      setMessages((prev) => (cursor ? [...page.messages, ...prev] : page.messages))
      setBefore(page.before)
    } catch {
      if (!life.signal.aborted) setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  onMount(() => void load())
  return (
    <div class="am-hosted-child" data-cloud-child={props.id}>
      <div class="am-review-toolbar">
        <Button size="small" variant="ghost" onClick={props.back}>
          {t("common.back")}
        </Button>
        <span>{props.title ?? props.id}</span>
        <Button size="small" variant="ghost" disabled={busy()} onClick={() => void load()}>
          {t("common.refresh")}
        </Button>
      </div>
      <div class="message-list-scroll">
        <div class="message-list-content">
          <Show when={failed()}>
            <div role="alert">
              {t("common.requestFailed")}{" "}
              <Button size="small" onClick={() => void load(before())}>
                {t("common.retry")}
              </Button>
            </div>
          </Show>
          <Show when={busy() && !messages().length}>
            <TranscriptLoading session={props.id} label={t("session.messages.loading")} />
          </Show>
          <Show when={before()}>
            {(cursor) => (
              <Button size="small" disabled={busy()} onClick={() => void load(cursor())}>
                {t("session.messages.loadEarlier")}
              </Button>
            )}
          </Show>
          <div class="message-list-turns">
            <For each={rows()}>
              {(row) => (
                <TranscriptRowView
                  row={row}
                  session={props.id}
                  hosted
                  openLink={props.openLink}
                  actions={{ ...props.diffActions, openSubagent: props.open }}
                />
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}
