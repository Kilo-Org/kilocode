import { createMemo, Show, type Component } from "solid-js"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { partFeedback } from "../../../../src/shared/browser-feedback"
import type { Message, Part, TextPart } from "../../types/messages"
import { BrowserReferences } from "./BrowserReferences"
import { ReviewComments } from "./ReviewComments"

interface VscodeUserMessageProps {
  message: Message
  parts: Part[]
  interrupted?: boolean
  queued?: boolean
  onDelete?: () => void
  onFork?: () => void
  onRevert?: () => void
}

export const VscodeUserMessage: Component<VscodeUserMessageProps> = (props) => {
  const text = createMemo(() => props.parts.find((part): part is TextPart => part.type === "text" && !part.synthetic))
  const feedback = createMemo(() => {
    const part = text()
    if (!part) return undefined
    return partFeedback(part.metadata, part.text)
  })
  const body = createMemo(() => feedback()?.body)

  return (
    <UserMessageDisplay
      message={props.message as unknown as Parameters<typeof UserMessageDisplay>[0]["message"]}
      parts={props.parts as unknown as Parameters<typeof UserMessageDisplay>[0]["parts"]}
      text={body()}
      copyText={feedback() ? text()?.text : undefined}
      header={
        feedback() ? (
          <>
            <Show when={feedback()?.review}>
              {(review) => (
                <ReviewComments comments={review().comments} sessionID={props.message.sessionID} variant="message" />
              )}
            </Show>
            <Show when={feedback()?.browserFeedback}>
              {(browser) => <BrowserReferences references={browser().references} variant="message" />}
            </Show>
          </>
        ) : undefined
      }
      interrupted={props.interrupted}
      queued={props.queued}
      onDelete={props.onDelete}
      onFork={props.onFork}
      onRevert={props.onRevert}
    />
  )
}
