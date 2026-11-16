// Select text in an assistant answer to quote it in the composer, comment on it, or copy it. Comments wait in the
// composer like diff review comments and go out with the next message, or one at a time with Send.
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { ChatReferenceData } from "../../../src/shared/review-comments"
import { clickSend, type SendIntent } from "../../../src/shared/prompt-send"
import { REVEAL_CHAT_REFERENCE } from "../components/chat/review-actions"
import { useLanguage } from "../context/language"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import type { ReplyHandler } from "./append-ready"
import { isMac } from "./pending-actions"
import { SendHint } from "./send-hint"
import { anchorRange, selectionAnchor, type ReplyAnchor } from "./transcript-reply-anchor"
import { highlightApi } from "./transcript-search-highlight"

const QUOTE = "kilo-reply-quote"
const COMMENT = "kilo-reply-comment"
const SENT = "kilo-reply-sent"
const ACTIVE = "kilo-reply-active"
const FLASH = "kilo-reply-flash"
const NAMES = [QUOTE, COMMENT, SENT, ACTIVE, FLASH]
const GAP = 6

type Draft = { anchor: ReplyAnchor; reference?: ChatReferenceData; editing: boolean }
type Position = { top: number; left: number }

export function TranscriptReply(props: {
  root: () => HTMLElement | undefined
  reply: ReplyHandler
  /** Chat references of the prompts already sent in this session. */
  sent: () => ChatReferenceData[]
}) {
  const language = useLanguage()
  const mac = isMac()
  const [selection, setSelection] = createSignal<{ anchor: ReplyAnchor; range: Range }>()
  const [draft, setDraft] = createSignal<Draft>()
  const [bar, setBar] = createSignal<Position>()
  const [card, setCard] = createSignal<Position>()
  const [flash, setFlash] = createSignal<ReplyAnchor>()
  const [copied, setCopied] = createSignal(false)
  const [text, setText] = createSignal("")
  let barEl: HTMLDivElement | undefined
  let cardEl: HTMLDivElement | undefined
  // The ranges of the pending comments in the last paint, so a click can tell which highlight it hit.
  let painted: { reference: ChatReferenceData; range: Range }[] = []
  // Set when an editing card opens, so the next placement focuses its field.
  let focus = false

  const paint = () => {
    const api = highlightApi()
    const root = props.root()
    if (!api || !root) return
    const resolve = (anchor: ReplyAnchor) => anchorRange(root, anchor)
    const pending = props.reply.pending()
    const ids = new Set(pending.map((item) => item.id))
    painted = pending.flatMap((reference) => {
      const range = reference.comment ? resolve(reference) : undefined
      return range ? [{ reference, range }] : []
    })
    const set = (name: string, ranges: (Range | undefined)[]) => {
      const list = ranges.filter((range): range is Range => !!range)
      if (list.length === 0) return api.registry.delete(name)
      api.registry.set(name, new api.ctor(...list))
    }
    const open = draft()
    const glow = flash()
    set(QUOTE, pending.filter((item) => !item.comment).map(resolve))
    set(
      COMMENT,
      painted.map((item) => item.range),
    )
    set(
      SENT,
      props
        .sent()
        .filter((item) => item.comment && !ids.has(item.id))
        .map(resolve),
    )
    set(ACTIVE, [open ? resolve(open.anchor) : undefined])
    set(FLASH, [glow ? resolve(glow) : undefined])
  }

  const place = () => {
    const root = props.root()
    if (!root) return
    const box = root.getBoundingClientRect()
    const clamp = (left: number, width: number) => Math.min(box.right - width - GAP, Math.max(box.left + GAP, left))
    const visible = (rect: DOMRect) => rect.bottom > box.top && rect.top < box.bottom
    const current = selection()
    const rect = current?.range.getBoundingClientRect()
    if (current && rect && visible(rect) && barEl) {
      const height = barEl.offsetHeight
      const top = rect.top - height - GAP < box.top ? rect.bottom + GAP : rect.top - height - GAP
      setBar({ top, left: clamp(rect.left + rect.width / 2 - barEl.offsetWidth / 2, barEl.offsetWidth) })
    } else setBar(undefined)
    const open = draft()
    const range = open ? anchorRange(root, open.anchor) : undefined
    const rects = range?.getClientRects()
    const last = rects?.[rects.length - 1]
    if (!range || !last || !visible(last) || !cardEl) return setCard(undefined)
    const height = cardEl.offsetHeight
    const below = last.bottom + GAP
    // Below the passage while it fits in the transcript, so it never covers the composer; above it otherwise.
    const top = below + height > box.bottom - GAP ? range.getBoundingClientRect().top - height - GAP : below
    setCard({ top, left: clamp(last.left - 8, cardEl.offsetWidth) })
    // The card is hidden until it is placed, and a hidden field cannot take focus.
    if (!focus) return
    focus = false
    cardEl.querySelector("textarea")?.focus({ preventScroll: true })
  }

  let frame: number | undefined
  const schedule = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      paint()
      place()
    })
  }

  createEffect(() => {
    props.reply.pending()
    props.sent()
    draft()
    flash()
    selection()
    schedule()
  })

  const read = () => {
    const current = window.getSelection()
    if (!current || current.isCollapsed || current.rangeCount === 0) return setSelection(undefined)
    const range = current.getRangeAt(0)
    const root = props.root()
    if (!root?.contains(range.commonAncestorContainer)) return setSelection(undefined)
    const anchor = selectionAnchor(range)
    setSelection(anchor ? { anchor, range } : undefined)
  }

  const dismiss = () => {
    setSelection(undefined)
    window.getSelection()?.removeAllRanges()
  }

  const quote = () => {
    const current = selection()
    if (!current) return
    props.reply.add(reference(current.anchor, ""), true)
    dismiss()
  }

  const comment = () => {
    const current = selection()
    if (!current) return
    setDraft({ anchor: current.anchor, editing: true })
    dismiss()
  }

  const copy = () => {
    const current = selection()
    if (!current) return
    void navigator.clipboard.writeText(current.range.toString())
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
      dismiss()
    }, 600)
  }

  const close = () => setDraft(undefined)

  const save = (send: boolean, intent: SendIntent = "enter") => {
    const open = draft()
    const body = text().trim()
    if (!open || !body) return
    const next = { ...(open.reference ?? reference(open.anchor, "")), comment: body }
    close()
    if (!send) return props.reply.add(next, false)
    if (open.reference) props.reply.remove(open.reference.id)
    props.reply.send(next, intent)
  }

  const sendSaved = (event: MouseEvent) => {
    const saved = draft()?.reference
    if (!saved) return
    close()
    props.reply.remove(saved.id)
    props.reply.send(saved, clickSend(event))
  }

  const remove = () => {
    const saved = draft()?.reference
    close()
    if (saved) props.reply.remove(saved.id)
  }

  // A highlight of a pending comment opens it, the way a comment highlight does in a document editor.
  const open = (event: MouseEvent) => {
    if (!window.getSelection()?.isCollapsed) return
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY)
    if (!caret) return
    const hit = painted.findLast((item) => item.range.isPointInRange(caret.startContainer, caret.startOffset))
    if (hit) setDraft({ anchor: hit.reference, reference: hit.reference, editing: false })
  }

  const keydown = (event: KeyboardEvent) => {
    if (!selection() || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea"))) return
    const key = event.key.toLowerCase()
    if (key !== "q" && key !== "c" && key !== "escape") return
    event.preventDefault()
    if (key === "q") return quote()
    if (key === "c") return comment()
    dismiss()
  }

  const fieldKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      return close()
    }
    // The same keys as a diff review comment: Enter sends it to Kilo, ⌥↵ uses the alternate delivery, Cmd/Ctrl+Enter saves it for later.
    if (!isEnterKeyCommitNotIme(event) || event.shiftKey) return
    event.preventDefault()
    save(!(event.metaKey || event.ctrlKey), clickSend(event))
  }

  // A row in the composer or a sent prompt asks to show its passage. The row may not be mounted yet, so look for the
  // passage for a few frames after the transcript scrolls to its message.
  const reveal = (event: Event) => {
    const target = (event as CustomEvent<ChatReferenceData>).detail
    if (!target) return
    window.dispatchEvent(
      new CustomEvent("scrollToMessage", { detail: { id: target.messageID, partId: target.partID } }),
    )
    let tries = 0
    const find = () => {
      const root = props.root()
      const range = root ? anchorRange(root, target) : undefined
      if (!root || !range) {
        if (++tries < 30) requestAnimationFrame(find)
        return
      }
      const rect = range.getBoundingClientRect()
      const box = root.getBoundingClientRect()
      root.scrollBy({ top: rect.top + rect.height / 2 - box.top - root.clientHeight / 2 })
      setFlash(target)
      setTimeout(() => setFlash((current) => (current === target ? undefined : current)), 1200)
    }
    requestAnimationFrame(find)
  }

  onMount(() => {
    const root = props.root()
    const up = () => setTimeout(read)
    const keyup = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === "Shift") read()
    }
    const change = () => {
      if (window.getSelection()?.isCollapsed) setSelection(undefined)
    }
    const press = (event: MouseEvent) => {
      const target = event.target as Node
      if (draft()?.editing && text().trim()) return
      if (cardEl?.contains(target)) return
      close()
    }
    // Rows mount and stream in without a scroll, so the highlights follow the DOM as well.
    const observer = new MutationObserver(schedule)
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true })
    // On the document, so a drag that ends outside the transcript still shows the toolbar.
    document.addEventListener("pointerup", up)
    root?.addEventListener("keyup", keyup)
    root?.addEventListener("scroll", schedule, { passive: true })
    root?.addEventListener("click", open)
    document.addEventListener("selectionchange", change)
    document.addEventListener("keydown", keydown)
    document.addEventListener("mousedown", press)
    window.addEventListener("resize", schedule)
    window.addEventListener(REVEAL_CHAT_REFERENCE, reveal)
    onCleanup(() => {
      observer.disconnect()
      document.removeEventListener("pointerup", up)
      root?.removeEventListener("keyup", keyup)
      root?.removeEventListener("scroll", schedule)
      root?.removeEventListener("click", open)
      document.removeEventListener("selectionchange", change)
      document.removeEventListener("keydown", keydown)
      document.removeEventListener("mousedown", press)
      window.removeEventListener("resize", schedule)
      window.removeEventListener(REVEAL_CHAT_REFERENCE, reveal)
      if (frame !== undefined) cancelAnimationFrame(frame)
      const api = highlightApi()
      for (const name of NAMES) api?.registry.delete(name)
    })
  })

  createEffect(() => {
    const open = draft()
    setText(open?.reference?.comment ?? "")
    focus = !!open?.editing
  })

  return (
    <Portal>
      <Show when={selection()}>
        <div
          ref={barEl}
          class="transcript-reply-bar"
          data-component="popover-content"
          role="toolbar"
          aria-label={language.t("chat.reply.toolbar")}
          data-placed={bar() ? "" : undefined}
          style={{ top: `${bar()?.top ?? 0}px`, left: `${bar()?.left ?? 0}px` }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <TooltipKeybind title={language.t("chat.reply.quoteHint")} keybind="Q" placement="top" openDelay={400}>
            <Button variant="ghost" size="small" onClick={quote}>
              <Icon name="reply" size="small" />
              {language.t("chat.reply.quote")}
            </Button>
          </TooltipKeybind>
          <TooltipKeybind title={language.t("chat.reply.commentHint")} keybind="C" placement="top" openDelay={400}>
            <Button variant="ghost" size="small" onClick={comment}>
              <Icon name="comment" size="small" />
              {language.t("agentManager.review.commentAction")}
            </Button>
          </TooltipKeybind>
          <TooltipKeybind
            title={language.t("chat.reply.copy")}
            keybind={mac ? "⌘C" : "Ctrl+C"}
            placement="top"
            openDelay={400}
          >
            <IconButton
              icon={copied() ? "check" : "copy"}
              variant="ghost"
              size="small"
              aria-label={language.t("chat.reply.copy")}
              onClick={copy}
            />
          </TooltipKeybind>
        </div>
      </Show>
      <Show when={draft()}>
        {(open) => (
          <div
            ref={cardEl}
            class="transcript-reply-card"
            data-component="popover-content"
            data-placed={card() ? "" : undefined}
            style={{ top: `${card()?.top ?? 0}px`, left: `${card()?.left ?? 0}px` }}
          >
            <div data-slot="popover-header">
              <h3 data-slot="popover-title">{language.t("agentManager.review.commentAction")}</h3>
              <IconButton
                data-slot="popover-close-button"
                icon="close"
                variant="ghost"
                size="small"
                aria-label={language.t("common.cancel")}
                onClick={close}
              />
            </div>
            <p data-slot="popover-description" class="transcript-reply-card-quote" title={open().anchor.quote}>
              {open().anchor.quote}
            </p>
            <div data-slot="popover-body">
              <Show
                when={open().editing}
                fallback={
                  <>
                    <div class="transcript-reply-card-text">{open().reference?.comment}</div>
                    <div class="transcript-reply-card-actions">
                      <Button variant="secondary" size="small" onClick={() => setDraft({ ...open(), editing: true })}>
                        {language.t("common.edit")}
                      </Button>
                      <Button variant="secondary" size="small" onClick={remove}>
                        {language.t("common.delete")}
                      </Button>
                      <span class="transcript-reply-card-gap" />
                      <SendHint title={language.t("diffViewer.comment.sendToKilo")} placement="bottom">
                        <Button variant="primary" size="small" onClick={sendSaved}>
                          {language.t("diffViewer.comment.sendToKilo")}
                        </Button>
                      </SendHint>
                    </div>
                  </>
                }
              >
                <TextField
                  multiline
                  label={language.t("agentManager.review.commentAction")}
                  hideLabel
                  placeholder={language.t("agentManager.review.commentPlaceholder")}
                  value={text()}
                  onChange={(value) => {
                    setText(value)
                    schedule()
                  }}
                  onKeyDown={fieldKeydown}
                />
                <div class="transcript-reply-card-actions">
                  <TooltipKeybind
                    title={language.t("chat.reply.commentLater")}
                    keybind={mac ? "⌘↵" : "Ctrl+Enter"}
                    placement="bottom"
                    openDelay={400}
                  >
                    <Button variant="secondary" size="small" disabled={!text().trim()} onClick={() => save(false)}>
                      {language.t("common.save")}
                    </Button>
                  </TooltipKeybind>
                  <Button variant="secondary" size="small" onClick={close}>
                    {language.t("common.cancel")}
                  </Button>
                  <span class="transcript-reply-card-gap" />
                  <SendHint
                    title={language.t("diffViewer.comment.sendToKilo")}
                    keybind={mac ? "↵" : "Enter"}
                    alternateKeybind={mac ? "⌥↵" : "Alt+Enter"}
                    placement="bottom"
                  >
                    <Button
                      variant="primary"
                      size="small"
                      disabled={!text().trim()}
                      onClick={(event: MouseEvent) => save(true, clickSend(event))}
                    >
                      {language.t("diffViewer.comment.sendToKilo")}
                    </Button>
                  </SendHint>
                </div>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </Portal>
  )
}

function reference(anchor: ReplyAnchor, comment: string): ChatReferenceData {
  return {
    id: `chat-${crypto.randomUUID()}`,
    origin: "chat",
    messageID: anchor.messageID,
    partID: anchor.partID,
    offset: anchor.offset,
    quote: anchor.quote,
    comment,
  }
}
