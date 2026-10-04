import { createMemo, createSignal, Show, type Component } from "solid-js"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { partFeedback } from "../../../../src/shared/browser-feedback"
import { injectedView } from "../../../../src/shared/injected-prompt"
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
  revertDisabled?: boolean
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
  const full = createMemo(() => (feedback()?.body ?? text()?.text)?.replace(ATTRIBUTION, ""))
  const view = createMemo(() => {
    const value = full()
    if (value == null) return undefined
    if (attribution()) return { label: "Sent by Kilo from another session" }
    return injectedView(text()?.metadata, value)
  })
  const [open, setOpen] = createSignal(false)
  const collapsed = createMemo(() => !!view()?.preview && !open())
  const body = createMemo(() => (collapsed() ? view()?.preview : full()))
  const openSource = () => {
    const id = attribution()
    if (!id || !props.onSelectSession) return
    props.onSelectSession(id)
  }

  // Build the header nodes once. UserMessageDisplay reads these props in
  // several Show conditions, and a JSX getter would rebuild a detached subtree
  // (with mounted Tooltip effects) on every read.
  const bubble = createMemo(() => {
    if (!view()) return undefined
    return (
      <div class="agent-manager-attribution" data-collapsed={collapsed() ? "" : undefined} dir="ltr">
        <span class="agent-manager-attribution-label">{view()?.label}</span>
        <Show when={attribution()}>
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
        </Show>
        <Show when={view()?.preview}>
          <button
            type="button"
            class="agent-manager-attribution-toggle"
            aria-expanded={open()}
            onClick={() => setOpen((value) => !value)}
          >
            {open() ? "Hide prompt" : "Show prompt"}
          </button>
        </Show>
      </div>
    )
  })
  const header = createMemo(() => {
    if (!feedback()) return undefined
    return (
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
    )
  })

  return (
    <UserMessageDisplay
      message={props.message as unknown as Parameters<typeof UserMessageDisplay>[0]["message"]}
      parts={props.parts as unknown as Parameters<typeof UserMessageDisplay>[0]["parts"]}
      text={body()}
      copyText={view() ? full() : feedback() ? text()?.text : undefined}
      bubbleHeader={bubble()}
      header={header()}
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
      revertDisabled={props.revertDisabled}
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
