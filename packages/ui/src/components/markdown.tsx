import { useMarked, deferredHighlight, fnv1a } from "../context/marked"
import { useI18n } from "../context/i18n"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import { checksum } from "@opencode-ai/shared/util/encode"
import { ComponentProps, createEffect, createResource, createSignal, onCleanup, splitProps } from "solid-js"
import { isServer } from "solid-js/web"
import { stream } from "./markdown-stream"
import { tryFastRender } from "../kilocode/markdown-fast-path" // kilocode_change

type Entry = {
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, Entry>()

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

type CopyLabels = {
  copy: string
  copied: string
}

const urlPattern = /^https?:\/\/[^\s<>()`"']+$/

function codeUrl(text: string) {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!urlPattern.test(href)) return
  try {
    const url = new URL(href)
    return url.toString()
  } catch {
    return
  }
}

function createIcon(path: string, slot: string) {
  const icon = document.createElement("div")
  icon.setAttribute("data-component", "icon")
  icon.setAttribute("data-size", "small")
  icon.setAttribute("data-slot", slot)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("data-slot", "icon-svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  icon.appendChild(svg)
  return icon
}

function createCopyButton(labels: CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("data-slot", "markdown-copy-button")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
  button.appendChild(createIcon(iconPaths.copy, "copy-icon"))
  button.appendChild(createIcon(iconPaths.check, "check-icon"))
  return button
}

function setCopyState(button: HTMLButtonElement, labels: CopyLabels, copied: boolean) {
  if (copied) {
    button.setAttribute("data-copied", "true")
    button.setAttribute("aria-label", labels.copied)
    button.setAttribute("data-tooltip", labels.copied)
    return
  }
  button.removeAttribute("data-copied")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
}

function ensureCodeWrapper(block: HTMLPreElement, labels: CopyLabels) {
  const parent = block.parentElement
  if (!parent) return
  const wrapped = parent.getAttribute("data-component") === "markdown-code"
  if (!wrapped) {
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
    wrapper.appendChild(createCopyButton(labels))
    return
  }

  const buttons = Array.from(parent.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
    (el): el is HTMLButtonElement => el instanceof HTMLButtonElement,
  )

  if (buttons.length === 0) {
    parent.appendChild(createCopyButton(labels))
    return
  }

  for (const button of buttons.slice(1)) {
    button.remove()
  }
}

function markCodeLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const href = codeUrl(code.textContent ?? "")
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null

    if (!href) {
      if (parentLink) parentLink.replaceWith(code)
      continue
    }

    if (parentLink) {
      parentLink.href = href
      continue
    }

    const link = document.createElement("a")
    link.href = href
    link.className = "external-link"
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  }
}

function decorate(root: HTMLDivElement, labels: CopyLabels) {
  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    ensureCodeWrapper(block, labels)
  }
  markCodeLinks(root)
}

function setupCodeCopy(root: HTMLDivElement, getLabels: () => CopyLabels) {
  const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

  const updateLabel = (button: HTMLButtonElement) => {
    const labels = getLabels()
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLButtonElement)) return
    const code = button.closest('[data-component="markdown-code"]')?.querySelector("code")
    const content = code?.textContent ?? ""
    if (!content) return
    const clipboard = navigator?.clipboard
    if (!clipboard) return
    await clipboard.writeText(content)
    const labels = getLabels()
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

  const buttons = Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]'))
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
  }
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    streaming?: boolean
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "streaming", "class", "classList"])
  const marked = useMarked()
  const i18n = useI18n()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [html] = createResource(
    () => ({
      text: local.text,
      key: local.cacheKey,
      streaming: local.streaming ?? false,
    }),
    async (src) => {
      if (isServer) return fallback(src.text)
      if (!src.text) return ""

      const base = src.key ?? checksum(src.text)
      return Promise.all(
        stream(src.text, src.streaming).map(async (block, index) => {
          const hash = checksum(block.raw)
          const key = base ? `${base}:${index}:${block.mode}` : hash

          if (key && hash) {
            const cached = cache.get(key)
            if (cached && cached.hash === hash) {
              touch(key, cached)
              return cached.html
            }
          }

          const next = await Promise.resolve(marked.parse(block.src))
          const safe = sanitize(next)
          if (key && hash) touch(key, { hash, html: safe })
          return safe
        }),
      )
        .then((list) => list.join(""))
        .catch(() => fallback(src.text))
    },
    { initialValue: fallback(local.text) },
  )

  let copyCleanup: (() => void) | undefined
  // kilocode_change start: generation counter prevents stale deferredHighlight
  // callbacks from overwriting copyCleanup set by a newer render (issue #6221).
  // The abort signal cancels the previous in-flight highlight pass so rapid
  // streaming tokens don't spawn concurrent passes racing on the same DOM nodes.
  const highlightState = { gen: 0, signal: { aborted: false } }
  // kilocode_change end

  // kilocode_change start: rAF-coalesced morphdom render.
  // During LLM token streaming, content updates arrive at 60–200Hz. Each
  // token reparses the full accumulated HTML (temp.innerHTML = content) and
  // diffs it via morphdom. CPU profile of a 7s streaming window showed 2,940
  // ParseHTML events totaling ~619ms (~46% of blocked main-thread time). The
  // user can only see one frame per 16ms anyway, so cap parses at ≤1 per
  // animation frame.
  let pendingFrame: number | undefined
  let pendingContent: string | undefined
  let pendingLabels: { copy: string; copied: string } | undefined
  // kilocode_change end

  createEffect(() => {
    const container = root()
    const content = local.text ? (html.latest ?? html() ?? "") : ""
    if (!container) return
    if (isServer) return

    if (!content) {
      // kilocode_change start: cancel any in-flight coalesced render so a
      // clear takes precedence over a pending parse.
      if (pendingFrame !== undefined) {
        cancelAnimationFrame(pendingFrame)
        pendingFrame = undefined
        pendingContent = undefined
        pendingLabels = undefined
      }
      // kilocode_change end
      container.innerHTML = ""
      return
    }

    const labels = {
      copy: i18n.t("ui.message.copy"),
      copied: i18n.t("ui.message.copied"),
    }

    // kilocode_change start
    const fast = tryFastRender(container, content, local.streaming, decorate, setupCodeCopy, () => labels, copyCleanup)
    if (fast.handled) {
      // Fast path took over; drop any pending coalesced morphdom from a
      // previous streaming turn on this same element.
      if (pendingFrame !== undefined) {
        cancelAnimationFrame(pendingFrame)
        pendingFrame = undefined
        pendingContent = undefined
        pendingLabels = undefined
      }
      copyCleanup = fast.copyCleanup
      kickHighlight(container, labels)
      return
    }
    // kilocode_change end

    // kilocode_change start: queue the latest content for a single rAF tick.
    // Further updates before the frame runs simply overwrite pendingContent,
    // so K rapid updates collapse to 1 parse instead of K.
    pendingContent = content
    pendingLabels = labels
    if (pendingFrame !== undefined) return
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = undefined
      const next = pendingContent
      const nextLabels = pendingLabels
      pendingContent = undefined
      pendingLabels = undefined
      if (next === undefined || nextLabels === undefined) return
      if (!container.isConnected) return

      const temp = document.createElement("div")
      temp.innerHTML = next
      decorate(temp, nextLabels)

      // kilocode_change start: morphdom guard for highlighted blocks (issue #6221)
      // During streaming, morphdom re-runs on every token. Without this guard,
      // it would revert already-highlighted <pre> blocks back to plain code.
      morphdom(container, temp, {
        childrenOnly: true,
        onBeforeElUpdated: (fromEl, toEl) => {
          if (
            fromEl instanceof HTMLButtonElement &&
            toEl instanceof HTMLButtonElement &&
            fromEl.getAttribute("data-slot") === "markdown-copy-button" &&
            toEl.getAttribute("data-slot") === "markdown-copy-button" &&
            fromEl.getAttribute("data-copied") === "true"
          ) {
            setCopyState(toEl, nextLabels, true)
          }
          if (fromEl.isEqualNode(toEl)) return false
          // Preserve Shiki-highlighted blocks — don't let morphdom revert them
          // to plain <pre><code> during streaming re-renders.
          // Note: "shiki" class is on <pre> (set by Shiki's codeToHtml output).
          // We compare data-source-hash (a lightweight FNV-1a hash stored by
          // deferredHighlight on the highlighted <pre>) against a hash of the
          // incoming code text to detect mid-stream content changes: if the code
          // changed, we let morphdom update so the block can be re-queued for
          // highlighting with the new content.
          if (
            fromEl instanceof HTMLElement &&
            fromEl.tagName === "PRE" &&
            fromEl.classList.contains("shiki") &&
            toEl instanceof HTMLElement &&
            toEl.tagName === "PRE" &&
            !toEl.classList.contains("shiki")
          ) {
            const fromHash = fromEl.getAttribute("data-source-hash")
            const toCode = toEl.querySelector("code")?.textContent ?? ""
            if (fromHash === fnv1a(toCode)) return false
            // Source changed during streaming — fall through so morphdom replaces
            // the stale highlighted block with the updated plain block, which will
            // be re-highlighted on the next deferredHighlight pass.
          }
          return true
        },
      })
      // kilocode_change end

      kickHighlight(container, nextLabels)
    })
    // kilocode_change end
  })

  // kilocode_change start: progressive Shiki highlighting (issue #6221, PR #7102).
  // Parser emits plain <pre><code data-lang="..."> blocks; we upgrade them to
  // Shiki-highlighted <pre class="shiki"> here via setTimeout(0) so initial
  // paint is instant and session switches with many code blocks don't freeze.
  // The generation counter + abort signal cancel a previous in-flight pass
  // when streaming tokens (or session switches) spawn a new render.
  function kickHighlight(container: HTMLDivElement, labels: { copy: string; copied: string }) {
    highlightState.signal.aborted = true
    const gen = ++highlightState.gen
    const signal = { aborted: false }
    highlightState.signal = signal
    void deferredHighlight(
      container,
      () => {
        if (gen !== highlightState.gen) return
        if (copyCleanup) copyCleanup()
        copyCleanup = setupCodeCopy(container, () => labels)
      },
      signal,
    )
  }
  // kilocode_change end

  onCleanup(() => {
    // kilocode_change: cancel any in-flight deferredHighlight pass so its
    // completion callback doesn't touch the unmounted DOM.
    highlightState.signal.aborted = true
    highlightState.gen++
    // kilocode_change: cancel any queued rAF parse so it doesn't touch the
    // unmounted DOM after dispose.
    if (pendingFrame !== undefined) {
      cancelAnimationFrame(pendingFrame)
      pendingFrame = undefined
      pendingContent = undefined
      pendingLabels = undefined
    }
    if (copyCleanup) copyCleanup()
  })

  return (
    <div
      data-component="markdown"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}
