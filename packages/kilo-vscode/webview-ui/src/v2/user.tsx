import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { createMemo, Show } from "solid-js"
import { partFeedback } from "../../../src/shared/browser-feedback"
import { useLanguage } from "../context/language"
import { BrowserReferences } from "./browser-references"

export function UserMessage(props: { message: SessionMessageUser; rowKey?: string; onFork?: () => void }) {
  const language = useLanguage()
  // A prompt with browser references carries them in metadata and starts with their Markdown, as in v1. The bubble
  // shows them as cards and the user's own text below; Copy keeps the full text the model received.
  const parsed = createMemo(() => partFeedback(props.message.metadata, props.message.text))
  const feedback = () => parsed()?.browserFeedback
  const message = createMemo(() => {
    const value = parsed()
    return value?.browserFeedback ? { ...props.message, text: value.body } : props.message
  })
  return (
    <div class="vscode-session-turn" data-row="user" data-message={props.message.id} data-row-key={props.rowKey}>
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
        />
      </div>
    </div>
  )
}
