import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay, type UserMessagePending } from "@kilocode/kilo-ui/message-part"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { createMemo, createSignal, Show } from "solid-js"
import { partFeedback } from "../../../src/shared/browser-feedback"
import { injectedView } from "../../../src/shared/injected-prompt"
import type { ToHost } from "../../../src/protocol"
import { imageMime } from "../../../src/shared/image-data-url"
import { ReviewComments } from "../components/chat/ReviewComments"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import { BrowserReferences } from "./browser-references"

export function UserMessage(props: {
  message: SessionMessageUser
  rowKey?: string
  sessionID?: string
  onFork?: () => void
  /** Opens the session that sent this prompt; the message links to it when set. */
  onSelectSession?: (id: string) => void
  /** Whether the current transcript search match is in this row. */
  searchActive?: boolean
  pending?: UserMessagePending
}) {
  const language = useLanguage()
  const vscode = useVSCode()
  // The host opens decodable data URLs in a VS Code editor tab; any other image keeps the in-page preview.
  const openImage = (uri: string, name: string | undefined) => {
    if (!imageMime(uri)) return false
    vscode.postMessage({ type: "previewImage", dataUrl: uri, filename: name || "image" } satisfies ToHost)
    return true
  }
  // A prompt can carry review comments and browser references in metadata, and starts with their Markdown. When the
  // parts agree, the cards show them and the bubble shows only the user's own text. Copy keeps the full text the
  // model received.
  const parsed = createMemo(() => partFeedback(props.message.metadata, props.message.text))
  const review = () => parsed()?.review
  const feedback = () => parsed()?.browserFeedback
  // A prompt Kilo composed, extended or delivered for another session reads as a labeled notice whose body can be
  // collapsed, instead of looking like something the user typed.
  const view = createMemo(() => injectedView(props.message.metadata, parsed()?.body ?? props.message.text))
  const [open, setOpen] = createSignal(false)
  const collapsed = createMemo(() => !!view()?.preview && !open())
  const message = createMemo(() => {
    const value = view()
    if (value) {
      const preview = value.preview
      return { ...props.message, text: preview && !open() ? preview : value.text }
    }
    const body = parsed()
    return body ? { ...props.message, text: body.body } : props.message
  })
  // Build the header nodes once. UserMessageDisplay reads these props in several Show conditions, and a getter would
  // rebuild a detached subtree (with mounted Tooltip effects) on every read.
  const bubble = createMemo(() => {
    const value = view()
    if (!value) return undefined
    return (
      <div class="agent-manager-attribution" data-collapsed={collapsed() ? "" : undefined} dir="ltr">
        <span class="agent-manager-attribution-label">{value.label}</span>
        <Show when={value.source && props.onSelectSession}>
          <Tooltip value={language.t("chat.injected.goToSource")} placement="top">
            <IconButton
              icon="square-arrow-top-right"
              size="small"
              variant="ghost"
              class="agent-manager-attribution-link"
              aria-label={language.t("chat.injected.goToSource")}
              onClick={() => {
                if (value.source) props.onSelectSession?.(value.source)
              }}
            />
          </Tooltip>
        </Show>
        <Show when={value.preview}>
          <button
            type="button"
            class="agent-manager-attribution-toggle"
            aria-expanded={open()}
            onClick={() => setOpen((current) => !current)}
          >
            {language.t(open() ? "chat.injected.hidePrompt" : "chat.injected.showPrompt")}
          </button>
        </Show>
      </div>
    )
  })
  return (
    <div
      class="vscode-session-turn"
      data-row="user"
      data-message={props.message.id}
      data-row-key={props.rowKey}
      data-pending={props.pending ? "" : undefined}
      data-search-active={props.searchActive ? "" : undefined}
    >
      <div class="vscode-session-turn-user">
        <Show when={review()}>
          {(value) => <ReviewComments comments={value().comments} sessionID={props.sessionID} variant="message" />}
        </Show>
        <UserMessageDisplay
          message={message()}
          copyLabel={language.t("ui.message.copyMessage")}
          copyText={view()?.text ?? props.message.text}
          header={
            <Show when={feedback()}>
              {(browser) => <BrowserReferences references={browser().references} variant="message" />}
            </Show>
          }
          bubbleHeader={bubble()}
          onFork={props.onFork}
          pending={props.pending}
          onOpenImage={openImage}
        />
      </div>
    </div>
  )
}
