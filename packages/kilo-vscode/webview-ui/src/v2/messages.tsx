// main's MessageList markup (components/chat/MessageList.tsx) over v2 messages: list, load-earlier, queued prompts,
// working line and the scroll-to-bottom button. Virtualization, the prompt rail and search come later.
import type { SessionMessageInfo } from "@opencode/client"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { useLanguage } from "../context/language"
import { AssistantMessage, ErrorCard } from "./assistant"
import { useV2 } from "./client"
import { UserMessage } from "./user"
import { Welcome } from "./welcome"

export function MessageList(props: {
  session?: string
  onSelectSession: (id: string) => void
  onShowHistory: () => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [older, setOlder] = createSignal(false)
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
        ref={(el) => autoScroll.scrollRef(el)}
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
                          {(assistant) => <AssistantMessage message={assistant()} session={id()} />}
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
                <Show when={working()}>
                  <div class="message-list-loading working-status-line" role="status">
                    <Spinner />
                    <span>{language.t("session.status.working")}</span>
                  </div>
                </Show>
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
