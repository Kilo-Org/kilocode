import { type Accessor, type Component, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../../context/language"
import { assistantCaptureOwned, assistantSelectionRow, selectionToolbarPosition } from "../../utils/assistant-selection"
import { annotationSelectionText } from "../../utils/annotation-anchors"

export interface SelectionCapture {
  transcript: HTMLElement
  sessionID: string
  row: HTMLElement
  messageID: string
  text: string
  rect: DOMRect
  range?: Range
  paragraph?: string
  textOnly?: boolean
}

interface SelectionToolbarProps {
  streamingMessageIDs: Accessor<Set<string>>
  transcript: Accessor<HTMLElement | undefined>
  sessionID: Accessor<string | undefined>
  disabled?: Accessor<boolean>
  enabled?: Accessor<boolean>
  onAdd: (capture: SelectionCapture) => void
  onExplain: (capture: SelectionCapture) => void
  onSelection?: (capture: SelectionCapture) => void
}

function selectionText(selection: Selection) {
  const element =
    selection.anchorNode?.nodeType === 1 ? (selection.anchorNode as Element) : selection.anchorNode?.parentElement
  const content = element?.closest('[data-component="text-part"]')
  const paragraph = element?.closest("p, li, pre, blockquote")
  return {
    textOnly: !!content && content.contains(selection.focusNode),
    paragraph: paragraph && content?.contains(paragraph) ? paragraph.textContent?.slice(0, 6000) : undefined,
  }
}

export function resolveAssistantCapture(
  streaming: Set<string>,
  transcript: HTMLElement | undefined,
  sessionID: string | undefined,
): SelectionCapture | undefined {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode || !selection.rangeCount)
    return undefined
  let text = selection.toString()
  if (!text.trim()) return undefined
  const range = selection.getRangeAt(0)
  const row = assistantSelectionRow(selection.anchorNode, selection.focusNode, range.commonAncestorContainer, {
    transcript,
    sessionID,
    streaming,
  })
  const messageID = row?.dataset.message
  if (!row || !messageID || !transcript || !sessionID) return undefined
  const context = selectionText(selection)
  if (context.textOnly) text = annotationSelectionText(row, range) ?? ""
  if (!text.trim()) return undefined
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return undefined
  return { transcript, sessionID, row, messageID, text, rect, range: range.cloneRange(), ...context }
}

export const SelectionToolbar: Component<SelectionToolbarProps> = (props) => {
  const language = useLanguage()
  const [capture, setCapture] = createSignal<SelectionCapture>()
  const [menu, setMenu] = createSignal<{ top: number; left: number }>()
  let toolbar: HTMLDivElement | undefined
  let frame = 0

  const hide = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    setMenu(undefined)
    setCapture(undefined)
  }

  const place = () => {
    frame = 0
    const value = capture()
    if (!value || !toolbar) return
    if (toolbar.offsetWidth === 0 || toolbar.offsetHeight === 0) return
    setMenu(
      selectionToolbarPosition(
        value.rect,
        { width: toolbar.offsetWidth, height: toolbar.offsetHeight },
        {
          width: document.documentElement.clientWidth || window.innerWidth,
          height: document.documentElement.clientHeight || window.innerHeight,
        },
      ),
    )
  }

  const onSelectionChange = () => {
    if (props.disabled?.()) {
      hide()
      return
    }
    const next = resolveAssistantCapture(props.streamingMessageIDs(), props.transcript(), props.sessionID())
    if (!next) {
      hide()
      return
    }
    setCapture(next)
    props.onSelection?.(next)
    setMenu(undefined)
    queueMicrotask(place)
    frame = requestAnimationFrame(place)
  }

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Element | null
    if (target?.closest(".selection-toolbar, [data-component='annotation-popover']")) return
    hide()
  }

  const currentCapture = () => {
    if (props.disabled?.()) {
      hide()
      return undefined
    }
    const value = capture()
    if (!value) return undefined
    const streaming = props.streamingMessageIDs()
    const transcript = props.transcript()
    const sessionID = props.sessionID()
    const owned = assistantCaptureOwned(value, { transcript, sessionID, streaming })
    const current = owned ? resolveAssistantCapture(streaming, transcript, sessionID) : undefined
    if (current?.row === value.row && current.messageID === value.messageID && current.text === value.text)
      return current
    hide()
    return undefined
  }

  const copySelection = async () => {
    const selected = currentCapture()
    if (!selected) return
    try {
      await navigator.clipboard.writeText(selected.text)
    } catch (error) {
      console.warn("[Kilo New] Failed to copy annotated selection:", error)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("annotations.copyFailed"),
      })
      return
    }
    hide()
  }

  const annotate = () => {
    if (props.enabled?.() === false) return
    const value = currentCapture()
    if (!value) return
    props.onAdd(value)
    hide()
    window.getSelection()?.removeAllRanges()
  }

  const explain = () => {
    if (props.enabled?.() === false) return
    const value = currentCapture()
    if (!value || value.textOnly === false) return
    props.onExplain(value)
    hide()
    window.getSelection()?.removeAllRanges()
  }

  createEffect(on([props.transcript, props.sessionID, () => props.disabled?.()], hide, { defer: true }))

  onMount(() => {
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("scroll", hide, { capture: true, passive: true })
    window.addEventListener("resize", hide)
    onCleanup(() => {
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("scroll", hide, true)
      window.removeEventListener("resize", hide)
    })
  })

  return (
    <Show when={capture()}>
      <div
        ref={toolbar}
        class="selection-toolbar"
        role="toolbar"
        aria-label={language.t("annotations.toolbarLabel")}
        data-positioned={menu() ? "" : undefined}
        style={{ top: `${menu()?.top ?? 0}px`, left: `${menu()?.left ?? 0}px` }}
        onPointerDown={(event) => event.preventDefault()}
      >
        <Button
          class="selection-toolbar-button"
          variant="ghost"
          size="small"
          disabled={props.disabled?.()}
          onClick={copySelection}
        >
          {language.t("common.copy")}
        </Button>
        <Show when={props.enabled?.() !== false}>
          <Button
            class="selection-toolbar-button"
            variant="primary"
            size="small"
            disabled={props.disabled?.()}
            onClick={annotate}
          >
            {language.t("annotations.annotate")}
          </Button>
          <Button
            class="selection-toolbar-button"
            variant="ghost"
            size="small"
            onClick={explain}
            disabled={capture()?.textOnly === false}
          >
            {language.t("responseLens.explain")}
          </Button>
        </Show>
      </div>
    </Show>
  )
}
