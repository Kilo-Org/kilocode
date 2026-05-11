import DOMPurify from "dompurify"
import { fnv1a } from "../context/marked"
import { mountMermaidActions } from "./markdown-mermaid-actions"

const svgConfig = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ["foreignObject"],
  FORBID_TAGS: ["script"],
  FORBID_CONTENTS: ["script"],
}

type Mermaid = typeof import("mermaid").default

export type MermaidLabels = {
  rendering: string
  renderError: (message: string) => string
  errorDefault: string
  errorEmpty: string
  copied: string
  copy: string
  download: string
  copySource: string
  copySvg: string
  copyPng: string
  downloadSvg: string
  downloadPng: string
}

const labels: MermaidLabels = {
  rendering: "Rendering Mermaid diagram...",
  renderError: (message) => `Mermaid render failed: ${message}`,
  errorDefault: "Unable to render Mermaid diagram.",
  errorEmpty: "Mermaid rendered an empty diagram.",
  copied: "Copied",
  copy: "Copy",
  download: "Download",
  copySource: "Copy Mermaid source",
  copySvg: "Copy SVG",
  copyPng: "Copy PNG",
  downloadSvg: "Download SVG",
  downloadPng: "Download PNG",
}

const cache: { promise?: Promise<Mermaid>; id: number; queue: Promise<void> } = {
  id: 0,
  queue: Promise.resolve(),
}

const actions = new WeakMap<HTMLElement, () => void>()

async function load() {
  if (!cache.promise) {
    cache.promise = import("mermaid").then((mod) => mod.default)
  }
  return cache.promise
}

function parse(color: string) {
  const value = color.trim()
  const hex = value.match(/^#([0-9a-f]{6})/i)
  if (hex?.[1]) {
    return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)]
  }

  const short = value.match(/^#([0-9a-f]{3})/i)
  if (short?.[1]) return short[1].split("").map((part) => parseInt(`${part}${part}`, 16))

  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgb?.[1] && rgb[2] && rgb[3]) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
}

function resolve(root: Element, value: string) {
  const trimmed = value.trim()
  if (!trimmed) return
  if (!trimmed.includes("var(")) return trimmed

  const doc = root.ownerDocument
  const probe = doc.createElement("span")
  probe.style.color = trimmed
  probe.style.position = "absolute"
  probe.style.visibility = "hidden"
  probe.style.pointerEvents = "none"

  const parent = root instanceof HTMLElement ? root : doc.body
  parent.appendChild(probe)
  const color = getComputedStyle(probe).color.trim()
  probe.remove()
  return color || trimmed
}

function css(root: Element, names: string[], fallback: string) {
  const style = getComputedStyle(root)
  for (const name of names) {
    const value = resolve(root, style.getPropertyValue(name))
    if (value) return value
  }
  return resolve(root, fallback) ?? fallback
}

function dark(root: Element, background: string) {
  if (document.body.classList.contains("vscode-light")) return false
  if (document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast"))
    return true

  const scheme = getComputedStyle(root).colorScheme
  if (scheme.includes("dark")) return true
  if (scheme.includes("light")) return false

  const rgb = parse(background)
  if (!rgb) return true
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.5
}

function config(root: Element) {
  const style = getComputedStyle(root)
  const background = css(
    root,
    ["--vscode-editor-background", "--background-base", "--surface-base"],
    style.backgroundColor || "#1e1e1e",
  )
  const panel = css(root, ["--vscode-editorWidget-background", "--surface-raised-base", "--surface-base"], background)
  const alt = css(root, ["--vscode-input-background", "--surface-weak", "--surface-base"], panel)
  const text = css(
    root,
    ["--vscode-editor-foreground", "--text-strong", "--vscode-foreground"],
    style.color || "#ffffff",
  )
  const weak = css(root, ["--vscode-descriptionForeground", "--text-weak", "--vscode-foreground"], text)
  const border = css(root, ["--vscode-editorWidget-border", "--vscode-editorGroup-border", "--border-weak-base"], weak)
  const accent = css(
    root,
    ["--vscode-textLink-foreground", "--vscode-charts-blue", "--text-interactive-base"],
    "#6cb6ff",
  )
  const critical = css(root, ["--vscode-errorForeground", "--vscode-charts-red", "--syntax-critical"], "#ff9580")
  const criticalBg = css(root, ["--vscode-inputValidation-errorBackground", "--surface-critical-base"], alt)

  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    theme: "base" as const,
    themeVariables: {
      darkMode: dark(root, background),
      background,
      textColor: text,
      mainBkg: panel,
      nodeBorder: border,
      lineColor: weak,
      primaryColor: panel,
      primaryTextColor: text,
      primaryBorderColor: border,
      secondaryColor: alt,
      tertiaryColor: background,
      classText: text,
      labelColor: text,
      actorLineColor: weak,
      actorBkg: panel,
      actorBorder: border,
      actorTextColor: text,
      fillType0: panel,
      fillType1: alt,
      fillType2: background,
      fontSize: "16px",
      fontFamily: "var(--font-family-sans)",
      noteTextColor: text,
      noteBkgColor: alt,
      noteBorderColor: border,
      critBorderColor: critical,
      critBkgColor: criticalBg,
      taskTextColor: text,
      taskTextOutsideColor: text,
      taskTextLightColor: text,
      sectionBkgColor: panel,
      sectionBkgColor2: alt,
      altBackground: panel,
      linkColor: accent,
      compositeBackground: panel,
      compositeBorder: border,
      titleColor: text,
      edgeLabelBackground: background,
    },
  }
}

function enqueue<T>(run: () => Promise<T>) {
  const next = cache.queue.then(run, run)
  cache.queue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function sanitize(svg: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(svg, svgConfig)
}

function mergeLabels(input?: Partial<MermaidLabels>) {
  return { ...labels, ...input }
}

function message(err: unknown, labels: MermaidLabels) {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return labels.errorDefault
}

function panel(wrapper: HTMLElement) {
  const found = Array.from(wrapper.children).find(
    (child): child is HTMLDivElement =>
      child instanceof HTMLDivElement && child.getAttribute("data-component") === "markdown-mermaid",
  )
  if (found) return found

  const el = document.createElement("div")
  el.setAttribute("data-component", "markdown-mermaid")
  wrapper.insertBefore(el, wrapper.firstChild)
  return el
}

function fail(wrapper: HTMLElement, pre: HTMLPreElement, err: unknown, labels: MermaidLabels) {
  const el = panel(wrapper)
  el.setAttribute("data-state", "error")
  el.textContent = labels.renderError(message(err, labels))
  wrapper.setAttribute("data-mermaid-state", "error")
  pre.hidden = false
}

function cleanupActions(el: HTMLElement) {
  const dispose = actions.get(el)
  if (!dispose) return
  dispose()
  actions.delete(el)
}

function serialize(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  return new XMLSerializer().serializeToString(clone)
}

function dataUrl(type: string, content: string) {
  return `data:${type};base64,${btoa(unescape(encodeURIComponent(content)))}`
}

function size(svg: SVGSVGElement) {
  const box = svg.viewBox.baseVal
  const rect = svg.getBoundingClientRect()
  const width = Math.max(Math.ceil(box?.width || rect.width || 1), 1)
  const height = Math.max(Math.ceil(box?.height || rect.height || 1), 1)
  return { width, height }
}

async function png(svg: SVGSVGElement) {
  const source = serialize(svg)
  const url = dataUrl("image/svg+xml", source)
  const img = new Image()
  const dims = size(svg)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("Unable to export Mermaid diagram."))
    img.src = url
  })

  const canvas = document.createElement("canvas")
  canvas.width = dims.width
  canvas.height = dims.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Unable to export Mermaid diagram.")
  ctx.drawImage(img, 0, 0, dims.width, dims.height)
  return canvas.toDataURL("image/png")
}

function download(url: string, filename: string) {
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function save(url: string, filename: string) {
  const event = new CustomEvent("kilo:save-image", {
    bubbles: true,
    cancelable: true,
    detail: { dataUrl: url, filename },
  })
  window.dispatchEvent(event)
  if (event.defaultPrevented) return
  download(url, filename)
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

async function copyPng(svg: SVGSVGElement) {
  const url = await png(svg)
  const blob = await (await fetch(url)).blob()
  if (typeof ClipboardItem === "undefined") {
    await navigator.clipboard.writeText(serialize(svg))
    return
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
}

function renderActions(el: HTMLDivElement, pre: HTMLPreElement, source: string, labels: MermaidLabels) {
  const svg = el.querySelector("svg")
  if (!(svg instanceof SVGSVGElement)) return

  cleanupActions(el)
  const old = el.querySelector('[data-slot="markdown-mermaid-actions-root"]')
  old?.remove()
  const sourceText = pre.querySelector("code")?.textContent ?? source
  const sourceSvg = () => serialize(svg)
  const sourceSvgUrl = () => dataUrl("image/svg+xml", sourceSvg())

  actions.set(
    el,
    mountMermaidActions(el, {
      labels,
      onCopySource: () => copyText(sourceText),
      onCopySvg: () => copyText(sourceSvg()),
      onCopyPng: () => copyPng(svg),
      onDownloadSvg: () => save(sourceSvgUrl(), "mermaid-diagram.svg"),
      onDownloadPng: async () => save(await png(svg), "mermaid-diagram.png"),
    }),
  )
}

export function preserveMermaid(fromEl: Element, toEl: Element) {
  if (!(fromEl instanceof HTMLElement)) return false
  if (!(toEl instanceof HTMLElement)) return false
  if (fromEl.getAttribute("data-component") !== "markdown-code") return false
  if (fromEl.getAttribute("data-kind") !== "mermaid") return false
  if (fromEl.getAttribute("data-mermaid-state") !== "rendered") return false
  if (toEl.getAttribute("data-component") !== "markdown-code") return false

  const from = fromEl.querySelector('pre > code[data-lang="mermaid"]')?.textContent ?? ""
  const to = toEl.querySelector('pre > code[data-lang="mermaid"]')?.textContent ?? ""
  if (!from || from !== to) return false
  return true
}

export function hasMermaid(root: HTMLElement) {
  return root.querySelector('pre > code[data-lang="mermaid"]') !== null
}

async function svg(renderer: Mermaid, source: string, cfg: ReturnType<typeof config>) {
  return enqueue(async () => {
    renderer.initialize(cfg)
    await renderer.parse(source)
    return renderer.render(`markdown-mermaid-${fnv1a(source)}-${cache.id++}`, source)
  })
}

export async function renderMermaid(
  root: HTMLDivElement,
  signal: { aborted: boolean },
  input?: Partial<MermaidLabels>,
) {
  const label = mergeLabels(input)
  const blocks = Array.from(root.querySelectorAll('pre > code[data-lang="mermaid"]'))
  if (blocks.length === 0) return

  const renderer = await load().catch((err) => {
    for (const block of blocks) {
      const pre = block.parentElement
      const wrapper = pre?.parentElement
      if (!(pre instanceof HTMLPreElement)) continue
      if (!(wrapper instanceof HTMLElement)) continue
      if (wrapper.getAttribute("data-component") !== "markdown-code") continue
      fail(wrapper, pre, err, label)
    }
  })
  if (!renderer) return

  for (const block of blocks) {
    if (signal.aborted || !root.isConnected) return
    if (!(block instanceof HTMLElement)) continue

    const pre = block.parentElement
    if (!(pre instanceof HTMLPreElement)) continue

    const wrapper = pre.parentElement
    if (!(wrapper instanceof HTMLElement)) continue
    if (wrapper.getAttribute("data-component") !== "markdown-code") continue

    const source = block.textContent ?? ""
    if (!source.trim()) continue

    const cfg = config(wrapper)
    const hash = fnv1a(source)
    const theme = fnv1a(JSON.stringify(cfg.themeVariables))
    const state = wrapper.getAttribute("data-mermaid-state")
    if (
      state === "rendered" &&
      wrapper.getAttribute("data-mermaid-hash") === hash &&
      wrapper.getAttribute("data-mermaid-theme") === theme
    ) {
      pre.hidden = true
      continue
    }

    const keep = state === "rendered" && wrapper.getAttribute("data-mermaid-hash") === hash

    wrapper.setAttribute("data-kind", "mermaid")
    wrapper.setAttribute("data-mermaid-hash", hash)
    wrapper.setAttribute("data-mermaid-theme", theme)
    wrapper.setAttribute("data-mermaid-state", "rendering")

    const el = panel(wrapper)
    if (!keep) {
      el.setAttribute("data-state", "rendering")
      el.textContent = label.rendering
      pre.hidden = false
    } else {
      pre.hidden = true
    }

    try {
      const result = await svg(renderer, source, cfg)
      if (signal.aborted || !root.isConnected || !wrapper.isConnected) return

      const safe = sanitize(result.svg)
      if (!safe) throw new Error(label.errorEmpty)

      cleanupActions(el)
      el.setAttribute("data-state", "rendered")
      el.innerHTML = safe
      renderActions(el, pre, source, label)
      wrapper.setAttribute("data-mermaid-state", "rendered")
      pre.hidden = true
    } catch (err) {
      if (signal.aborted || !root.isConnected || !wrapper.isConnected) return
      fail(wrapper, pre, err, label)
    }
  }
}
