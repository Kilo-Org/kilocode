import { type Component, createEffect, createMemo, onCleanup } from "solid-js"
import type { AnnotationSide, DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs"
import { markdownCommentBlocks, type MarkdownRange } from "./markdown-comment-ranges"
import type { AnnotationMeta } from "./review-annotations"
import { annotationSelector, isAnnotationMutation } from "./markdown-annotation-mutation"

type Insert = "after" | "list" | "table"

type Anchor = MarkdownRange & {
  line: number
  element: HTMLElement
  insert: Insert
}

export interface MarkdownAnnotationLayerProps {
  pane: () => HTMLElement | undefined
  root: () => HTMLElement | undefined
  text: string
  side: AnnotationSide
  annotations: DiffLineAnnotation<AnnotationMeta>[]
  renderAnnotation: ((annotation: DiffLineAnnotation<AnnotationMeta>) => HTMLElement | undefined) | undefined
  enableGutterUtility: boolean
  onGutterUtilityClick: ((range: SelectedLineRange) => void) | undefined
  onLineNumberClick: ((event: { annotationSide: AnnotationSide; lineNumber: number }) => void) | undefined
}

function children(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement)) return false
    if (child.classList.contains("am-markdown-inline-annotations")) return false
    if (child.classList.contains("am-markdown-list-annotation")) return false
    if (child.classList.contains("am-markdown-table-annotation")) return false
    return true
  })
}

function listItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement)) return false
    if (child.tagName !== "LI") return false
    return !child.classList.contains("am-markdown-list-annotation")
  })
}

function tableRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll("tr")).filter((row) => {
    return !row.classList.contains("am-markdown-table-annotation")
  })
}

function anchors(root: HTMLElement, source: ReturnType<typeof markdownCommentBlocks>): Anchor[] {
  const rendered = children(root)
  const result: Anchor[] = []
  let index = 0

  for (const block of source) {
    const element = rendered[index]
    if (!element) break
    index += 1

    if (block.type === "table" && element.tagName === "TABLE") {
      const rows = tableRows(element)
      for (const [row, range] of block.rows.entries()) {
        const target = rows[row]
        if (target) result.push({ ...range, line: range.start, element: target, insert: "table" })
      }
      continue
    }

    if (block.type === "list" && (element.tagName === "UL" || element.tagName === "OL")) {
      const items = listItems(element)
      for (const [item, range] of block.items.entries()) {
        const target = items[item]
        if (target) result.push({ ...range, line: range.start, element: target, insert: "list" })
      }
      continue
    }

    result.push({ start: block.start, end: block.end, line: block.start, element, insert: "after" })
  }

  return result
}

function matches(annotation: DiffLineAnnotation<AnnotationMeta>, anchor: Anchor, side: AnnotationSide): boolean {
  if (annotation.side !== side) return false
  if (annotation.lineNumber < anchor.start) return false
  if (annotation.lineNumber > anchor.end) return false
  return true
}

const selector = annotationSelector()

function removeInserted(root: HTMLElement, layer: HTMLElement): void {
  layer.replaceChildren()
  root.querySelectorAll(selector).forEach((node) => node.remove())
}

function insertHost(anchor: Anchor, host: HTMLElement): void {
  if (anchor.insert === "table" && anchor.element instanceof HTMLTableRowElement) {
    const row = document.createElement("tr")
    row.className = "am-markdown-table-annotation"
    const cell = document.createElement("td")
    cell.colSpan = Math.max(1, anchor.element.cells.length)
    cell.appendChild(host)
    row.appendChild(cell)
    anchor.element.parentNode?.insertBefore(row, anchor.element.nextSibling)
    return
  }

  if (anchor.insert === "list") {
    const item = document.createElement("li")
    item.className = "am-markdown-list-annotation"
    item.appendChild(host)
    anchor.element.parentNode?.insertBefore(item, anchor.element.nextSibling)
    return
  }

  anchor.element.parentNode?.insertBefore(host, anchor.element.nextSibling)
}

export const MarkdownAnnotationLayer: Component<MarkdownAnnotationLayerProps> = (props) => {
  let layer: HTMLDivElement | undefined
  let observer: MutationObserver | undefined
  let frame: number | undefined
  const ranges = createMemo(() => markdownCommentBlocks(props.text))

  const schedule = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(render)
  }

  const render = () => {
    frame = undefined
    const pane = props.pane()
    const root = props.root()
    if (!pane || !root || !layer) return

    observer?.disconnect()
    removeInserted(root, layer)

    const list = anchors(root, ranges())
    for (const anchor of list) {
      const annotations = props.annotations.filter((annotation) => matches(annotation, anchor, props.side))
      if (annotations.length > 0) {
        const host = document.createElement("div")
        host.className = "am-markdown-inline-annotations"
        for (const annotation of annotations) {
          const element = props.renderAnnotation?.(annotation)
          if (element) host.appendChild(element)
        }
        insertHost(anchor, host)
      }
    }

    const paneBox = pane.getBoundingClientRect()
    for (const anchor of list) {
      const box = anchor.element.getBoundingClientRect()
      const row = document.createElement("div")
      row.className = "am-markdown-target"
      row.style.top = `${box.top - paneBox.top}px`
      row.style.height = `${Math.max(20, box.height)}px`

      if (props.enableGutterUtility) {
        const button = document.createElement("button")
        button.className = "am-markdown-comment-button"
        button.type = "button"
        button.title = `Comment on line ${anchor.line}`
        button.setAttribute("aria-label", `Comment on line ${anchor.line}`)
        button.textContent = "+"
        button.addEventListener("click", (event) => {
          event.stopPropagation()
          props.onGutterUtilityClick?.({ side: props.side, start: anchor.start, end: anchor.end })
        })
        row.appendChild(button)
      }

      const line = document.createElement("button")
      line.className = "am-markdown-line-number"
      line.type = "button"
      line.textContent = `${anchor.line}`
      line.setAttribute("aria-label", `Open line ${anchor.line}`)
      line.addEventListener("click", (event) => {
        event.stopPropagation()
        props.onLineNumberClick?.({ annotationSide: props.side, lineNumber: anchor.line })
      })
      row.appendChild(line)
      layer.appendChild(row)
    }

    observer?.observe(root, { childList: true, subtree: true })
  }

  createEffect(() => {
    props.text
    props.side
    props.annotations
    props.enableGutterUtility
    props.onGutterUtilityClick
    props.onLineNumberClick
    props.pane()
    props.root()
    schedule()
  })

  createEffect(() => {
    const root = props.root()
    if (!root) return
    observer?.disconnect()
    observer = new MutationObserver((mutations) => {
      if (mutations.every(isAnnotationMutation)) return
      schedule()
    })
    observer.observe(root, { childList: true, subtree: true })
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    observer?.disconnect()
    const root = props.root()
    if (root && layer) removeInserted(root, layer)
  })

  return <div class="am-markdown-gutter-layer" ref={layer} />
}
