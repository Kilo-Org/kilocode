import { createMemo, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { ToolRegistry, UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { partReview } from "../../../../src/shared/review-comments"
import type { Message, Part, TextPart } from "../../types/messages"
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

const indicator = ToolRegistry.render("skill")

export const VscodeUserMessage: Component<VscodeUserMessageProps> = (props) => {
  const text = createMemo(() => props.parts.find((part): part is TextPart => part.type === "text" && !part.synthetic))
  const skill = createMemo(() => {
    for (const part of props.parts) {
      if (part.type !== "text") continue
      const value = part.metadata?.skill
      if (!value || typeof value !== "object") continue
      const metadata = value as Record<string, unknown>
      if (metadata.userInitiated !== true || typeof metadata.name !== "string") continue
      return metadata.name
    }
  })
  const review = createMemo(() => {
    const part = text()
    if (!part) return undefined
    return partReview(part.metadata, part.text)
  })
  const body = createMemo(() => review()?.body)

  return (
    <UserMessageDisplay
      message={props.message as unknown as Parameters<typeof UserMessageDisplay>[0]["message"]}
      parts={props.parts as unknown as Parameters<typeof UserMessageDisplay>[0]["parts"]}
      text={body()}
      copyText={review() ? text()?.text : undefined}
      header={
        review() ? (
          <ReviewComments comments={review()!.data.comments} sessionID={props.message.sessionID} variant="message" />
        ) : undefined
      }
      after={
        skill() && indicator ? (
          <Dynamic
            component={indicator}
            tool="skill"
            input={{ name: skill() }}
            metadata={{ userInitiated: true }}
            status="completed"
          />
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
