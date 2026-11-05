import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay, type UserMessagePending } from "@kilocode/kilo-ui/message-part"
import { createMemo, Show } from "solid-js"
import { partFeedback } from "../../../src/shared/browser-feedback"
import type { ToHost } from "../../../src/protocol"
import { imageMime } from "../../../src/shared/image-data-url"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import { BrowserReferences } from "./browser-references"

export function UserMessage(props: {
  message: SessionMessageUser
  rowKey?: string
  onFork?: () => void
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
  // A prompt with browser references carries them in metadata and starts with their Markdown, as in v1. The bubble
  // shows them as cards and the user's own text below; Copy keeps the full text the model received.
  const parsed = createMemo(() => partFeedback(props.message.metadata, props.message.text))
  const feedback = () => parsed()?.browserFeedback
  const message = createMemo(() => {
    const value = parsed()
    return value?.browserFeedback ? { ...props.message, text: value.body } : props.message
  })
  return (
    <div
      class="vscode-session-turn"
      data-row="user"
      data-message={props.message.id}
      data-row-key={props.rowKey}
      data-pending={props.pending ? "" : undefined}
    >
      <div class="vscode-session-turn-user">
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
        />
      </div>
    </div>
  )
}
