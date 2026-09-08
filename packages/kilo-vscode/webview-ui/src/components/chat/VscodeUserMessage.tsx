import { createMemo, Show, type Component } from "solid-js"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { partFeedback } from "../../../../src/shared/browser-feedback"
import { imageMime } from "../../../../src/shared/image-data-url"
import type { Message, Part, TextPart } from "../../types/messages"
import { BrowserReferences } from "./BrowserReferences"
import { ReviewComments } from "./ReviewComments"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"

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
  onSelectSession?: (id: string) => boolean | void
  isSessionOpen?: (id: string) => boolean
}

const ATTRIBUTION = /\n\n<!-- kilo-agent-manager source=([^ ]+) -->$/

export const VscodeUserMessage: Component<VscodeUserMessageProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const text = createMemo(() => props.parts.find((part): part is TextPart => part.type === "text" && !part.synthetic))
  const attribution = createMemo(() => text()?.text.match(ATTRIBUTION)?.[1])
  const feedback = createMemo(() => {
    const part = text()
    if (!part) return undefined
    return partFeedback(part.metadata, part.text)
  })
  const body = createMemo(() =>
    (feedback()?.body ?? (attribution() ? text()?.text : undefined))?.replace(ATTRIBUTION, ""),
  )
  const openSource = () => {
    const id = attribution()
    if (!id || !props.onSelectSession) return
    props.onSelectSession(id)
  }

  return (
    <UserMessageDisplay
      message={props.message as unknown as Parameters<typeof UserMessageDisplay>[0]["message"]}
      parts={props.parts as unknown as Parameters<typeof UserMessageDisplay>[0]["parts"]}
      text={body()}
      copyText={attribution() ? body() : feedback() ? text()?.text : undefined}
      bubbleHeader={
        attribution() ? (
          <div class="agent-manager-attribution" dir="ltr">
            <span class="agent-manager-attribution-label">Sent by Kilo from another session</span>
            <Show
              when={props.onSelectSession && props.isSessionOpen?.(attribution() ?? "") !== false}
              fallback={<span class="agent-manager-attribution-status">Session not open</span>}
            >
              <Tooltip value="Go to originating session" placement="top">
                <IconButton
                  icon="square-arrow-top-right"
                  size="small"
                  variant="ghost"
                  class="agent-manager-attribution-link"
                  aria-label="Go to originating session"
                  onClick={openSource}
                />
              </Tooltip>
            </Show>
          </div>
        ) : undefined
      }
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
      edit={
        props.onEdit
          ? { label: language.t("common.edit"), onClick: props.onEdit, disabled: props.editDisabled }
          : undefined
      }
      queuedDisabled={props.queuedDisabled}
      onDelete={props.onDelete}
      onFork={props.onFork}
      onRevert={props.onRevert}
      onImageClick={(dataUrl, filename) => {
        // Only claim the click when the host can decode the image; anything
        // else (remote URLs, non-base64 data URLs) keeps the modal fallback
        // rather than opening nothing at all.
        if (!imageMime(dataUrl)) return false
        vscode.postMessage({ type: "previewImage", dataUrl, filename: filename || "image" })
        return true
      }}
    />
  )
}
