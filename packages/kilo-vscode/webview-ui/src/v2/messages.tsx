// main's MessageList markup (components/chat/MessageList.tsx) over v2 messages: list, load-earlier, queued prompts
// and the scroll-to-bottom button. The working indicator is in the session dock, as on main. Virtualization, the prompt rail and search come later.
import type { SessionMessageInfo } from "@opencode/client"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { useLanguage } from "../context/language"
import { onTimelineHighlight, type TimelineHighlight } from "../utils/timeline/highlight"
import { AssistantMessage, ErrorCard } from "./assistant"
import { useV2 } from "./client"
import { UserMessage } from "./user"
import { Welcome } from "./welcome"

export function MessageList(props: {
  session?: string
  actions?: ToolActions
  onSelectSession: (id: string) => void
  onShowHistory: () => void
  /** Receives the handler the session dock calls to scroll to the bottom, as on main. */
  onScrollToBottomReady?: (handler: (() => void) | undefined) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [older, setOlder] = createSignal(false)
  const [highlight, setHighlight] = createSignal<TimelineHighlight>()
  onCleanup(onTimelineHighlight(setHighlight))
  let scrollEl: HTMLDivElement | undefined
  // createData already puts pending user input into the message list. Only queued input waits for the end of the
  // turn, so it moves below the transcript, as in the TUI (packages/tui/src/routes/session/rows.ts).
  const queued = () =>
    props.session
      ? v2.data.session.pending
          .list(props.session)
          .flatMap((item) => (item.type === "user" && item.delivery === "queue" ? [item] : []))
      : []
  const messages = () => {
    const all = props.session ? v2.data.session.message.list(props.session) : []
    const ids = new Set(queued().map((item) => item.id))
    return ids.size === 0 ? all : all.filter((message) => !ids.has(message.id))
  }
  const working = () => !!props.session && v2.data.session.status(props.session) === "running"
  const empty = () => !props.session || (messages().length === 0 && queued().length === 0)
  const autoScroll = createAutoScroll({ working })
  props.onScrollToBottomReady?.(() => autoScroll.resume())
  onCleanup(() => props.onScrollToBottomReady?.(undefined))

  // A task-timeline bar click scrolls the transcript to its part, or to its
  // message when the part is not mounted. Jumps stay instant: while pinned at
  // the bottom a smooth scroll's first frames sit within the auto-follow
  // threshold, which would resume following and snap the view back down.
  const onScrollToMessage = (e: Event) => {
    const detail = (e as CustomEvent<{ id: string; partId?: string }>).detail
    if (!detail?.id) return
    const el = scrollEl
    if (!el) return
    const target =
      (detail.partId ? el.querySelector<HTMLElement>(`[data-part-id="${CSS.escape(detail.partId)}"]`) : undefined) ??
      el.querySelector<HTMLElement>(`[data-message="${CSS.escape(detail.id)}"]`)
    if (!target) return
    autoScroll.pause()
    const box = target.getBoundingClientRect()
    const container = el.getBoundingClientRect()
    el.scrollBy({ top: box.top - container.top - Math.max(0, (container.height - box.height) / 2) })
  }
  window.addEventListener("scrollToMessage", onScrollToMessage)
  onCleanup(() => window.removeEventListener("scrollToMessage", onScrollToMessage))

  const loadOlder = () => {
    const id = props.session
    if (!id) return
    setOlder(true)
    void v2.data.session.message
      .loadMore(id)
      .catch(v2.report)
      .finally(() => setOlder(false))
  }

  return (
    <div class="message-list-container">
      <div
        ref={(el) => {
          scrollEl = el
          autoScroll.scrollRef(el)
        }}
        onScroll={autoScroll.handleScroll}
        class="message-list"
        data-slot="message-list"
        role="log"
        aria-live="polite"
      >
        <div
          ref={autoScroll.contentRef}
          data-slot="message-list-content"
          class={empty() ? "message-list-content-empty" : "message-list-content"}
        >
          <Show when={empty()}>
            <Welcome onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />
          </Show>
          <Show when={!empty() && props.session}>
            {(id) => (
              <>
                <Show when={older()}>
                  <div class="message-list-page-loader" role="status">
                    <Spinner />
                    <span>{language.t("session.messages.loadingEarlier")}</span>
                  </div>
                </Show>
                <Show when={v2.data.session.message.more(id()) && !older()}>
                  <button class="message-list-load-older" onClick={loadOlder}>
                    {language.t("session.messages.loadEarlier")}
                  </button>
                </Show>
                <div class="message-list-turns" data-loaded-messages={messages().length}>
                  <For each={messages()}>
                    {(message, index) => (
                      <Switch>
                        <Match when={message.type === "user" && message}>
                          {(user) => <UserMessage message={user()} />}
                        </Match>
                        <Match when={message.type === "assistant" && message}>
                          {(assistant) => (
                            <AssistantMessage
                              message={assistant()}
                              session={id()}
                              actions={props.actions}
                              highlight={highlight}
                            />
                          )}
                        </Match>
                        {/* A run can fail before any step, for example without a usable model. As the TUI, the idle
                            row carries that error. A failed step already shows its error on the assistant row. */}
                        <Match when={message.type === "idle" && !stepFailed(messages()[index() - 1]) && message.error}>
                          {(error) => (
                            <div class="vscode-session-turn" data-row="error" data-message={message.id}>
                              <ErrorCard error={error()} />
                            </div>
                          )}
                        </Match>
                      </Switch>
                    )}
                  </For>
                  <For each={queued()}>
                    {(item) => (
                      <div class="message-list-queued" data-queued="true">
                        <UserMessage
                          message={{ id: item.id, type: "user", text: item.payload.text, time: item.time }}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </div>
      </div>
      <Show when={autoScroll.userScrolled()}>
        <IconButton
          icon="arrow-down-to-line"
          variant="ghost"
          size="small"
          class="scroll-to-bottom-button"
          onClick={() => autoScroll.resume()}
          aria-label={language.t("session.messages.scrollToBottom")}
        />
      </Show>
    </div>
  )
}

function stepFailed(message: SessionMessageInfo | undefined) {
  return message?.type === "assistant" && !!message.error
}
