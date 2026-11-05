import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { createMemo, Show } from "solid-js"
import { partReview } from "../../../src/shared/review-comments"
import { ReviewComments } from "../components/chat/ReviewComments"
import { useLanguage } from "../context/language"

export function UserMessage(props: {
  message: SessionMessageUser
  rowKey?: string
  sessionID?: string
  onFork?: () => void
}) {
  const language = useLanguage()
  // A sent prompt keeps the review markdown in its text and the comments in its metadata. When both agree, the
  // header shows the review comments and the bubble shows only the body, as v1's user message did.
  const review = createMemo(() => partReview(props.message.metadata, props.message.text))
  const display = createMemo(() => {
    const value = review()
    return value ? { ...props.message, text: value.body } : props.message
  })
  return (
    <div class="vscode-session-turn" data-row="user" data-message={props.message.id} data-row-key={props.rowKey}>
      <div class="vscode-session-turn-user">
        <Show when={review()}>
          {(value) => (
            <ReviewComments comments={value().data.comments} sessionID={props.sessionID} variant="message" />
          )}
        </Show>
        <UserMessageDisplay
          message={display()}
          copyLabel={language.t("ui.message.copyMessage")}
          onFork={props.onFork}
        />
      </div>
    </div>
  )
}
