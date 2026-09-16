import { createEffect, createSignal, type Accessor } from "solid-js"
import {
  buildHighlightSegments,
  buildPromptSegments,
  expandPastes,
  findPastePlaceholders,
  isCollapsiblePaste,
  pasteInsertion,
  pastePlaceholder,
  rebasePastes,
  shiftPastes,
  type PasteRange,
  type PromptSegment,
} from "../components/chat/prompt-input-utils"

export interface PasteCollapse {
  /** Collapsed blocks in the current text, in text order. */
  pastes: Accessor<PasteRange[]>
  /** Split the current text for the highlight overlay, chips included. */
  segments: (text: string, paths: Set<string>) => PromptSegment[]
  /** The text with every collapsed block restored to its full content. */
  plainText: (text: string) => string
  /** Restore collapsed blocks for arbitrary text paired with stored backing. */
  plainTextFor: (text: string, texts: readonly string[]) => string
  /** Claim a large plain-text clipboard paste. Returns true when it was collapsed. */
  paste: (
    event: ClipboardEvent,
    textarea: HTMLTextAreaElement,
    setText: (value: string) => void,
    after?: () => void,
  ) => boolean
  /** Restore one collapsed block at the caret, in place. */
  expand: (id: number, textarea: HTMLTextAreaElement, setText: (value: string) => void, after?: () => void) => boolean
  /** Replace the tracked blocks, e.g. when a saved draft is restored. */
  load: (text: string, texts: readonly string[]) => void
  /** Delete a whole collapsed block on backspace, like a mention token. */
  backspace: (
    event: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (value: string) => void,
  ) => boolean
  /** Skip the caret over a collapsed block on ArrowLeft/ArrowRight. */
  arrow: (event: KeyboardEvent, textarea: HTMLTextAreaElement | undefined) => boolean
  /** Copy (or cut) a selection with collapsed blocks expanded. */
  clipboard: (
    event: ClipboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (value: string) => void,
    cut?: boolean,
  ) => boolean
}

/** Inserts above this size skip execCommand, which turns superlinear for large writes. */
const directLimit = 2048

/**
 * Collapses large pasted blocks behind a `[Pasted ~N lines]` chip in the prompt
 * input. The chip is literal text in the textarea, so the overlay and textarea
 * stay aligned; the full content is tracked here by range and restored on
 * expand, copy, and send.
 */
export function usePasteCollapse(opts: { enabled: Accessor<boolean>; text: Accessor<string> }): PasteCollapse {
  const [pastes, setPastes] = createSignal<PasteRange[]>([])
  let counter = 0
  let prev = ""
  let pendingArrow: ReturnType<typeof setTimeout> | undefined

  const reconcile = (value: string) => {
    if (value === prev) return
    const next = shiftPastes(pastes(), prev, value)
    prev = value
    setPastes(next)
  }

  createEffect(() => reconcile(opts.text()))

  const write = (
    textarea: HTMLTextAreaElement,
    start: number,
    end: number,
    value: string,
    expected: string,
    setText: (value: string) => void,
  ) => {
    // Mark the resulting text before the edit. execCommand raises an input event
    // that runs the reconcile effect, and that effect must treat this text as
    // already applied or it shifts the ranges a second time.
    prev = expected
    textarea.focus()
    textarea.setSelectionRange(start, end)
    if (value.length > directLimit) {
      // execCommand is superlinear for large inserts (seconds for ~100 KB) and
      // fires an input event that reparses the whole prompt. Set the value
      // directly instead; the caller still gets the resulting text and range.
      textarea.value = expected
    } else {
      try {
        document.execCommand("insertText", false, value)
      } catch {
        // execCommand is unavailable in some hosts; the direct write below covers it.
      }
      if (textarea.value !== expected) textarea.value = expected
    }
    setText(expected)
    // The caller knows the exact edited span, so shift by it instead of inferring
    // the span from a diff, which cannot tell two identical chips apart.
    setPastes(rebasePastes(pastes(), start, end, value.length))
  }

  const paste = (
    event: ClipboardEvent,
    textarea: HTMLTextAreaElement,
    setText: (value: string) => void,
    after?: () => void,
  ): boolean => {
    if (!opts.enabled() || event.defaultPrevented) return false
    const data = event.clipboardData
    if (!data) return false
    // Files and images keep their own paste paths.
    if (Array.from(data.items ?? []).some((item) => item.kind === "file")) return false
    if (Array.from(data.types ?? []).includes("Files")) return false
    const value = data.getData("text/plain")
    if (!value) return false
    const text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    if (!text || !isCollapsiblePaste(text)) return false

    event.preventDefault()
    const current = textarea.value
    const start = textarea.selectionStart ?? current.length
    const end = textarea.selectionEnd ?? start
    const placeholder = pastePlaceholder(text)
    const insertion = pasteInsertion(current, start, end, placeholder)

    write(textarea, start, end, insertion.inserted, insertion.text, setText)
    // write() has already moved the older ranges; append the new block.
    const entry: PasteRange = { id: ++counter, start: insertion.start, end: insertion.end, text }
    setPastes([...pastes(), entry].sort((a, b) => a.start - b.start))
    textarea.setSelectionRange(insertion.caret, insertion.caret)
    after?.()
    return true
  }

  const expand = (
    id: number,
    textarea: HTMLTextAreaElement,
    setText: (value: string) => void,
    after?: () => void,
  ): boolean => {
    const entry = pastes().find((item) => item.id === id)
    if (!entry) return false
    const current = textarea.value
    if (entry.end > current.length) return false
    const expected = current.slice(0, entry.start) + entry.text + current.slice(entry.end)
    // write() rebases against this exact edit, which drops this block and shifts
    // the blocks after it, so the remaining ranges are already correct here.
    write(textarea, entry.start, entry.end, entry.text, expected, setText)
    const caret = entry.start + entry.text.length
    textarea.setSelectionRange(caret, caret)
    after?.()
    return true
  }

  const load = (text: string, texts: readonly string[]) => {
    const marks = findPastePlaceholders(text)
    // Save and restore always happen together, so a mismatch means the text was
    // edited outside this control. Keep no backing rather than pair the wrong
    // content with a chip.
    const items: PasteRange[] = []
    if (marks.length === texts.length) {
      for (let index = 0; index < marks.length; index++) {
        const full = texts[index]
        if (!full) continue
        const mark = marks[index]!
        items.push({ id: ++counter, start: mark.start, end: mark.end, text: full })
      }
    }
    prev = text
    setPastes(items)
  }

  const plainTextFor = (text: string, texts: readonly string[]) => {
    const marks = findPastePlaceholders(text)
    // A mismatch means the text was edited outside this control. Keep the text
    // as-is rather than pair the wrong content with a chip.
    if (marks.length !== texts.length) return text
    const items: PasteRange[] = []
    for (let index = 0; index < marks.length; index++) {
      const full = texts[index]
      if (!full) continue
      const mark = marks[index]!
      items.push({ id: index, start: mark.start, end: mark.end, text: full })
    }
    return expandPastes(text, items)
  }

  const backspace = (
    event: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (value: string) => void,
  ): boolean => {
    if (!textarea || event.key !== "Backspace" || event.isComposing) return false
    if (textarea.selectionStart !== textarea.selectionEnd) return false
    const cursor = textarea.selectionStart ?? 0
    const entry = pastes().find((item) => item.end === cursor)
    if (!entry) return false

    event.preventDefault()
    const current = textarea.value
    // Take a single trailing space with the block so a removed chip leaves no gap.
    const end = current[entry.end] === " " ? entry.end + 1 : entry.end
    const expected = current.slice(0, entry.start) + current.slice(end)
    write(textarea, entry.start, end, "", expected, setText)
    textarea.setSelectionRange(entry.start, entry.start)
    return true
  }

  const arrow = (event: KeyboardEvent, textarea: HTMLTextAreaElement | undefined): boolean => {
    if (!textarea) return false
    if (pendingArrow) clearTimeout(pendingArrow)
    pendingArrow = undefined
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
    if (textarea.selectionStart !== textarea.selectionEnd) return false

    const value = textarea.value
    const from = textarea.selectionStart ?? 0
    const forward = event.key === "ArrowRight"
    pendingArrow = setTimeout(() => {
      pendingArrow = undefined
      if (textarea.value !== value) return
      const at = textarea.selectionStart ?? 0
      if (at === from) return
      for (const item of pastes()) {
        if (at > item.start && at < item.end) {
          const target = forward ? item.end : item.start
          textarea.setSelectionRange(target, target)
          return
        }
      }
    }, 0)
    return false
  }

  const clipboard = (
    event: ClipboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (value: string) => void,
    cut = false,
  ): boolean => {
    if (!textarea) return false
    const value = textarea.value
    const start = textarea.selectionStart ?? 0
    const end = textarea.selectionEnd ?? 0
    if (start === end) return false
    const inSelection = pastes()
      .filter((item) => item.start >= start && item.end <= end)
      .map((item) => ({ ...item, start: item.start - start, end: item.end - start }))
    if (inSelection.length === 0) return false
    event.clipboardData?.setData("text/plain", expandPastes(value.slice(start, end), inSelection))
    event.preventDefault()
    if (cut) write(textarea, start, end, "", value.slice(0, start) + value.slice(end), setText)
    return true
  }

  return {
    pastes,
    segments: (text, paths) => {
      const list = pastes()
      // Fast path with no collapsed blocks: keep the original segment build so
      // typing stays on the same code path it had before this feature.
      if (list.length === 0) {
        return buildHighlightSegments(text, paths).map((part) => ({
          text: part.text,
          kind: part.highlight ? ("mention" as const) : ("plain" as const),
        }))
      }
      return buildPromptSegments(text, paths, list)
    },
    plainText: (text) => expandPastes(text, pastes()),
    plainTextFor,
    paste,
    expand,
    load,
    backspace,
    arrow,
    clipboard,
  }
}
