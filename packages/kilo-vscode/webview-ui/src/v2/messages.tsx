// main's MessageList markup (components/chat/MessageList.tsx) over v2 messages: list, load-earlier, queued prompts,
// working line and the scroll-to-bottom button. Virtualization, the prompt rail and search come later.
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { useLanguage } from "../context/language"
import { AssistantMessage } from "./assistant"
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
  const messages = () => (props.session ? (v2.data.session.message.list(props.session) ?? []) : [])
  const pending = () => (props.session ? (v2.data.session.pending.list(props.session) ?? []) : [])
  const working = () => !!props.session && v2.data.session.status(props.session) === "running"
  const empty = () => !props.session || (messages().length === 0 && pending().length === 0)
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
                    {(message) => (
                      <Switch>
                        <Match when={message.type === "user" && message}>
                          {(user) => <UserMessage message={user()} />}
                        </Match>
                        <Match when={message.type === "assistant" && message}>
                          {(assistant) => <AssistantMessage message={assistant()} session={id()} />}
                        </Match>
                      </Switch>
                    )}
                  </For>
                  <For each={pending()}>
                    {(item) => (
                      <Show when={item.type === "user" && item}>
                        {(user) => (
                          <div class="message-list-queued" data-queued="true">
                            <UserMessage
                              message={{ id: user().id, type: "user", text: user().payload.text, time: user().time }}
                            />
                          </div>
                        )}
                      </Show>
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
