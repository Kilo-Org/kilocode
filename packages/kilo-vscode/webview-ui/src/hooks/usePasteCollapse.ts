import { createEffect, createSignal, type Accessor } from "solid-js"
import {
  buildPromptSegments,
  expandPastes,
  findPastePlaceholders,
  isCollapsiblePaste,
  pastePlaceholder,
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
    textarea.focus()
    textarea.setSelectionRange(start, end)
    try {
      document.execCommand("insertText", false, value)
    } catch {
      // execCommand is unavailable in some hosts; the direct write below covers it.
    }
    if (textarea.value !== expected) textarea.value = expected
    setText(expected)
    reconcile(expected)
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
    const before = current.slice(0, start)
    const afterText = current.slice(end)
    const prefix = before.length > 0 && !/\s$/.test(before) ? " " : ""
    const suffix = afterText.length > 0 && !/^\s/.test(afterText) ? " " : ""
    const inserted = `${prefix}${placeholder}${suffix}`
    const expected = `${before}${inserted}${afterText}`
    const rangeStart = before.length + prefix.length

    write(textarea, start, end, inserted, expected, setText)
    // reconcile() has already moved the older ranges; append the new block.
    const entry: PasteRange = { id: ++counter, start: rangeStart, end: rangeStart + placeholder.length, text }
    setPastes([...pastes(), entry].sort((a, b) => a.start - b.start))
    const caret = rangeStart + inserted.length
    textarea.setSelectionRange(caret, caret)
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
    // write() reconciles against the edit, which drops this block and shifts the
    // blocks after it, so the remaining ranges are already correct here.
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
    segments: (text, paths) => buildPromptSegments(text, paths, pastes()),
    plainText: (text) => expandPastes(text, pastes()),
    paste,
    expand,
    load,
    backspace,
    arrow,
    clipboard,
  }
}
