import { createMemo, createSignal, Show, type Component } from "solid-js"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { injectedView } from "../../../../src/shared/injected-prompt"
import { imageMime } from "../../../../src/shared/image-data-url"
import type { Message, Part, TextPart } from "../../types/messages"
import { useVSCode } from "../../context/vscode"

interface VscodeUserMessageProps {
  message: Message
  parts: Part[]
  interrupted?: boolean
  queued?: boolean
  onFork?: () => void
  onSelectSession?: (id: string) => boolean | void
  isSessionOpen?: (id: string) => boolean
}

export const VscodeUserMessage: Component<VscodeUserMessageProps> = (props) => {
  const vscode = useVSCode()
  const text = createMemo(() => props.parts.find((part): part is TextPart => part.type === "text" && !part.synthetic))
  const full = createMemo(() => text()?.text)
  const view = createMemo(() => {
    const value = full()
    if (value == null) return undefined
    return injectedView(text()?.metadata, value)
  })
  const [open, setOpen] = createSignal(false)
  const collapsed = createMemo(() => !!view()?.preview && !open())
  const body = createMemo(() => (collapsed() ? view()?.preview : full()))
  // Build the header nodes once. UserMessageDisplay reads these props in
  // several Show conditions, and a JSX getter would rebuild a detached subtree
  // (with mounted Tooltip effects) on every read.
  const bubble = createMemo(() => {
    if (!view()) return undefined
    return (
      <div class="agent-manager-attribution" data-collapsed={collapsed() ? "" : undefined} dir="ltr">
        <span class="agent-manager-attribution-label">{view()?.label}</span>
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
  return (
    <UserMessageDisplay
      message={props.message as unknown as Parameters<typeof UserMessageDisplay>[0]["message"]}
      parts={props.parts as unknown as Parameters<typeof UserMessageDisplay>[0]["parts"]}
      text={body()}
      copyText={view() ? full() : undefined}
      bubbleHeader={bubble()}
      interrupted={props.interrupted}
      queued={props.queued}
      onFork={props.onFork}
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
