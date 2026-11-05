import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { createMemo, Show } from "solid-js"
import { partFeedback } from "../../../src/shared/browser-feedback"
import { ReviewComments } from "../components/chat/ReviewComments"
import { useLanguage } from "../context/language"
import { BrowserReferences } from "./browser-references"

export function UserMessage(props: {
  message: SessionMessageUser
  rowKey?: string
  sessionID?: string
  onFork?: () => void
}) {
  const language = useLanguage()
  // A prompt can carry review comments and browser references in metadata, and starts with their Markdown. When the
  // parts agree, the cards show them and the bubble shows only the user's own text, as v1's user message did.
  const parsed = createMemo(() => partFeedback(props.message.metadata, props.message.text))
  const review = () => parsed()?.review
  const feedback = () => parsed()?.browserFeedback
  const display = createMemo(() => {
    const value = parsed()
    return value ? { ...props.message, text: value.body } : props.message
  })
  return (
    <div class="vscode-session-turn" data-row="user" data-message={props.message.id} data-row-key={props.rowKey}>
      <div class="vscode-session-turn-user">
        <Show when={review()}>
          {(value) => <ReviewComments comments={value().comments} sessionID={props.sessionID} variant="message" />}
        </Show>
        <UserMessageDisplay
          message={display()}
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
