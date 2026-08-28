import { createMemo, type Component } from "solid-js"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { partReview } from "../../../../src/shared/review-comments"
import type { Message, Part, TextPart } from "../../types/messages"
import { ReviewComments } from "./ReviewComments"
import { useLanguage } from "../../context/language"

interface VscodeUserMessageProps {
  message: Message
  parts: Part[]
  interrupted?: boolean
  queued?: boolean
  onEdit?: () => void
  queuedDisabled?: boolean
  editDisabled?: boolean
  onDelete?: () => void
  onFork?: () => void
  onRevert?: () => void
}

export const VscodeUserMessage: Component<VscodeUserMessageProps> = (props) => {
  const language = useLanguage()
  const text = createMemo(() => props.parts.find((part): part is TextPart => part.type === "text" && !part.synthetic))
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
      interrupted={props.interrupted}
      queued={props.queued}
      edit={
        props.onEdit
          ? { label: language.t("common.edit"), onClick: props.onEdit, disabled: props.editDisabled }
          : undefined
      }
      queuedDisabled={props.queuedDisabled}
      onDelete={props.onDelete}
      onFork={props.onFork}
      onRevert={props.onRevert}
    />
  )
}
