import { WorkingIndicator } from "../src/components/shared/WorkingIndicator"
import { CloudHistoryPlaceholder } from "./cloud/history-placeholder"
import { cloudNotice, hostedActivity, preparing } from "./cloud/activity"
import { Selectors } from "../src/v2/selectors"
import { createCloudSelection } from "./cloud/selection"
import type { HostedChoice } from "./cloud/route"
import { SessionDockFrame } from "../src/components/chat/SessionDockFrame"
import { SetupOverlay } from "./SetupOverlay"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import type { UserMessagePending } from "@kilocode/kilo-ui/message-part"
import type { FormInfo, FormField, SessionMessageInfo } from "@opencode/client"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { CloudChild } from "./cloud/child"
import { useInterruptKey } from "../src/v2/interrupt-key"
import type { CloudDiffActions } from "./cloud/tool-diff"
import { cloudLink } from "./cloud/links"
import { useBridge } from "./v2/vscode"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../src/context/language"
import { PromptInput } from "../src/v2/prompt"
import { SpeechToTextStatusProvider } from "../src/components/speech-to-text/status"
import { QuestionDock } from "../src/v2/question"
import { cloudDraftMayFocus } from "./cloud/focus"
import { PermissionDock } from "../src/v2/permission"
import { TranscriptRowView } from "../src/v2/transcript-row"
import { transcriptRows } from "../src/v2/transcript"
import { PreparationProgress } from "./cloud/progress"
import type { CloudSessionPool } from "./cloud/session-pool"
import "./hosted-chat.css"

export function HostedChat(props: {
  pool: CloudSessionPool
  directory: string
  target: KiloHostedRpc.Target
  initial?: HostedChoice
  diffActions?: CloudDiffActions
}) {
  const lease = props.pool.acquire(props.directory, props.target)
  const chat = lease.chat
  useInterruptKey(
    () => chat.live() && chat.busy() && !chat.pending(),
    () => void chat.interrupt(),
    (e) => {
      const el = e.target instanceof Element ? e.target : document.activeElement
      return (
        !!el?.closest(".am-cloud-detail") &&
        !el.closest(
          ".am-diff-panel-wrapper,[data-cloud-child],[role=dialog],[role=menu],[data-component=question-dock],[data-component=permission-shortcuts]",
        ) &&
        !document.querySelector("[role=dialog],[role=menu],.popup-selector[data-expanded]")
      )
    },
  )
  const [children, setChildren] = createSignal<{ id: string; title?: string }[]>([])
  const child = (id: string, title?: string) =>
    setChildren((prev) => (prev.length >= 5 || prev.some((c) => c.id === id) ? prev : [...prev, { id, title }]))
  onCleanup(lease.release)
  const { t } = useLanguage()
  const bridge = useBridge()
  const openLink = async (uri: string) => {
    const link = cloudLink(uri)
    if (!link) return
    try {
      const url = link.kind === "external" ? link.url : await chat.previewLink(link.port, link.path)
      if (url) bridge.postMessage({ type: "agentManager.openExternal", url })
    } catch {
      showToast({ title: t("common.requestFailed") })
    }
  }
  const composer = createCloudSelection(() => {
    const last = chat.messages().findLast((m) => m.type === "assistant")
    return last ? { mode: last.agent, model: last.model.id } : props.initial
  }, false)
  const rows = createMemo<ReturnType<typeof transcriptRows>>(
    (prev) => transcriptRows(chat.messages() as readonly SessionMessageInfo[], prev),
    [] as ReturnType<typeof transcriptRows>,
  )
  const activity = createMemo(() => hostedActivity(chat))
  const notice = createMemo(() => cloudNotice(chat))
  const statusText = () => {
    if (preparing(chat)) return stage()
    if (chat.phase() === "reconnecting") return t("session.status.offline")
    if (activity() === "retry") return t("session.status.retry")
  }
  const stage = () =>
    (
      chat.snapshot()?.progress?.step ?? chat.snapshot()?.progress?.steps.findLast((s) => s.status === "running")?.step
    )?.replaceAll("_", " ") ?? t("migration.sessionProgress.preparing")
  const setup = () => !rows().length && (preparing(chat) || (!!props.initial && chat.phase() === "opening"))
  const historyState = () => {
    if (rows().length || setup() || chat.snapshot()?.error || notice() || chat.phase() === "failed") return
    return chat.snapshot()?.historyReady ? "empty" : "loading"
  }
  // A prompt in transit already shows Sending on its bubble. Thinking belongs to the running turn.
  const working = () =>
    !notice() &&
    !setup() &&
    chat.phase() !== "opening" &&
    (activity() === "retry" || (activity() === "busy" && (chat.busy() || preparing(chat))))
  // Snapshots deserialize fresh objects; keep the same form and its focused answer until that request is resolved.
  const request = createMemo(() => chat.questions()[0], undefined, { equals: (a, b) => a?.id === b?.id })
  const queued = createMemo(() => new Set(chat.queued()))
  const pending = (id: string): UserMessagePending | undefined => {
    if (queued().has(id))
      return {
        status: t("session.pending.status.queued"),
        actions: [
          {
            key: "delete",
            icon: "close-small",
            label: t("common.cancel"),
            disabled: chat.pending(),
            onClick: () => void chat.cancelQueued(id),
          },
        ],
      }
    if (chat.sending() === id) return { status: t("session.pending.status.starting"), actions: [] }
  }
  const unpublished = createMemo(() => {
    const ids = new Set(queued())
    for (const message of chat.messages()) ids.delete(message.id)
    return [...ids]
  })
  const form = createMemo(() => {
    const q = request()
    return q && questionForm(q, props.target.sessionID)
  })
  let scroll!: HTMLDivElement
  let content!: HTMLDivElement
  let follow = true

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (follow) scroll.scrollTop = scroll.scrollHeight
    })
    observer.observe(content)
    onCleanup(() => {
      observer.disconnect()
    })
  })
  return (
    <div class="chat-view" data-hosted-session={props.target.sessionID}>
      <div class="chat-messages-wrapper">
        <Show when={children().at(-1)} keyed>
          {(entry) => (
            <CloudChild
              diffActions={props.diffActions}
              chat={chat}
              openLink={openLink}
              id={entry.id}
              title={entry.title}
              open={child}
              back={() => setChildren((prev) => prev.slice(0, -1))}
            />
          )}
        </Show>
        <Show when={setup()}>
          <SetupOverlay
            cloud
            title={t("migration.sessionProgress.preparing")}
            state={{ active: true, message: stage() }}
          />
        </Show>
        <div class="chat-messages">
          <div class="message-list-container">
            <div
              class="message-list"
              ref={scroll}
              onScroll={() => (follow = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 32)}
            >
              <div ref={content} class="message-list-content" data-slot="message-list-content">
                <Show when={historyState() === "loading"}>
                  <CloudHistoryPlaceholder />
                </Show>
                <Show when={historyState() === "empty"}>
                  <div class="am-hosted-empty" role="status">
                    {t("agentManager.cloud.chat.empty")}
                  </div>
                </Show>
                <Show when={!setup() && chat.snapshot()?.progress?.phase !== "ready" && chat.snapshot()?.progress}>
                  {(p) => <PreparationProgress progress={p()} />}
                </Show>
                <Show when={chat.before()}>
                  <div class="message-list-history">
                    <button
                      class="message-list-load-older"
                      disabled={chat.paging()}
                      onClick={() => void chat.loadEarlier()}
                    >
                      {t("session.messages.loadEarlier")}
                    </button>
                  </div>
                </Show>
                <div class="message-list-turns">
                  <For each={rows().map((r) => r.key)}>
                    {(_key, index) => (
                      <TranscriptRowView
                        row={rows()[index()]!}
                        session={props.target.sessionID}
                        hosted
                        pending={pending}
                        openLink={openLink}
                        actions={{ ...props.diffActions, openSubagent: child }}
                      />
                    )}
                  </For>
                  <For each={unpublished()}>
                    {(id) => (
                      <div data-component="user-message" class="am-hosted-queued" data-queued-message={id}>
                        <div data-slot="user-message-queued-indicator">
                          {t("session.pending.status.queued")}
                          <IconButton
                            icon="close-small"
                            variant="ghost"
                            size="small"
                            label={t("common.cancel")}
                            disabled={chat.pending()}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => void chat.cancelQueued(id)}
                          />
                        </div>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={form()}>
                  {(f) => (
                    <QuestionDock
                      form={f()}
                      actions={{
                        cancel: async () => chat.question(f().id),
                        reply: async (answer) =>
                          chat.question(
                            f().id,
                            f().fields.map((field) => {
                              const a = answer[field.key]
                              return Array.isArray(a) ? a : a === undefined ? [] : [String(a)]
                            }),
                          ),
                      }}
                    />
                  )}
                </Show>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="chat-input" inert={children().length > 0} style={{ display: children().length ? "none" : undefined }}>
        <Show when={notice()}>
          {(key) => (
            <div class="am-cloud-notice" role="status" data-cloud-notice={key()}>
              <span>{t(key())}</span>
              <Show when={key() === "agentManager.cloud.disconnected" && chat.phase() === "ready"}>
                <Button size="small" variant="ghost" onClick={chat.retry}>
                  {t("common.retry")}
                </Button>
              </Show>
            </div>
          )}
        </Show>
        <Show when={(!notice() && chat.snapshot()?.error) || chat.phase() === "failed" || chat.failure()}>
          <div role="alert" class="startup-error-banner">
            <div class="startup-error-header">
              <span class="startup-error-message">
                {chat.snapshot()?.error ?? chat.reason() ?? t("common.requestFailed")}{" "}
              </span>
              <Button size="small" variant="ghost" onClick={chat.retry}>
                {t("common.retry")}
              </Button>
            </div>
          </div>
        </Show>
        <SessionDockFrame active={working()}>
          <div
            class="session-dock-state"
            data-active={working() ? "" : undefined}
            inert={!working()}
            aria-hidden={!working()}
          >
            <div class="session-working">
              <WorkingIndicator
                status="running"
                submitting={chat.pending()}
                timing={undefined}
                text={statusText()}
                retry={undefined}
                onCancel={() => void chat.interrupt()}
                onScrollToBottom={() => {
                  follow = true
                  scroll.scrollTop = scroll.scrollHeight
                }}
              />
            </div>
          </div>
        </SessionDockFrame>
        <For each={chat.permissions()}>
          {(p) => (
            <PermissionDock
              request={{
                id: p.id,
                sessionID: props.target.sessionID,
                action: p.permission,
                resources: [...p.patterns],
              }}
              onAnswer={async (decision) => chat.permission(p.id, decision)}
            />
          )}
        </For>
        <SpeechToTextStatusProvider>
          <PromptInput
            textOnly
            focusOnDraftChange={cloudDraftMayFocus}
            allowImages
            queueOnly
            slash={{
              entries: chat.commands,
              discover: chat.discover,
              run: async (entry, args, mode, items) => {
                chat.setDraft(`/${entry.name}${args ? ` ${args}` : ""}`)
                const selected = composer.choice()
                return (
                  (await chat.send(
                    { agent: selected?.mode, model: selected?.model },
                    items,
                    {
                      name: entry.name,
                      args,
                    },
                    mode === "now",
                  )) === true
                )
              },
            }}
            draftKey={JSON.stringify(props.target)}
            running={chat.busy()}
            disabled={chat.phase() !== "ready" || preparing(chat)}
            blocked={!!chat.questions().length || !!chat.permissions().length}
            onStop={() => void chat.interrupt()}
            onSend={async (text, delivery, input) => {
              chat.setDraft(text)
              const selected = composer.choice()
              return (
                (await chat.send(
                  { model: selected?.model, agent: selected?.mode },
                  input?.items,
                  undefined,
                  delivery === "now",
                )) === true
              )
            }}
            selectors={
              <Selectors selection={composer.selection} blocked={!!request() || !!chat.permissions().length} />
            }
          />
        </SpeechToTextStatusProvider>
      </div>
    </div>
  )
}

function questionForm(q: KiloHostedRpc.Question, sessionID: string): FormInfo | undefined {
  const fields = q.questions.map(
    (f, i): FormField => ({
      type: f.multiple ? "multiselect" : "string",
      key: String(i),
      title: f.header,
      description: f.question,
      required: true,
      custom: f.custom,
      options: f.options.map((o) => ({ ...o, value: o.label })),
    }),
  )
  const [first, ...rest] = fields
  return (
    first && { id: q.id, sessionID, title: first.title ?? "", metadata: { kind: "question" }, fields: [first, ...rest] }
  )
}
