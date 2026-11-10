import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay, type ToolActions, type UserMessagePending } from "@kilocode/kilo-ui/message-part"
import { createMemo, Show } from "solid-js"
import { partFeedback } from "../../../src/shared/browser-feedback"
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
  /** Whether the current transcript search match is in this row. */
  searchActive?: boolean
  pending?: UserMessagePending
  /** Opens the files and past chats the message's `@` mentions name. */
  actions?: ToolActions
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
  // parts agree, the cards show them and the bubble shows only the user's own text, as v1's user message did. Copy
  // keeps the full text the model received.
  const parsed = createMemo(() => partFeedback(props.message.metadata, props.message.text))
  const review = () => parsed()?.review
  const feedback = () => parsed()?.browserFeedback
  const message = createMemo(() => {
    const value = parsed()
    return value ? { ...props.message, text: value.body } : props.message
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
          copyText={props.message.text}
          header={
            <Show when={feedback()}>
              {(browser) => <BrowserReferences references={browser().references} variant="message" />}
            </Show>
          }
          onFork={props.onFork}
          pending={props.pending}
          onOpenImage={openImage}
          onOpenFile={
            props.actions?.openFile
              ? (path) => props.actions?.openFile?.(path, undefined, undefined, props.sessionID)
              : undefined
          }
          onOpenSession={props.actions?.openSession}
        />
      </div>
    </div>
  )
}
