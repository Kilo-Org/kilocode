import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"

function integer(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

async function coordinates(file: string, source: { line?: number; column?: number }, size: number) {
  const line = integer(source.line)
  const text = line && size <= 1_048_576 ? await readFile(file, "utf8").catch(() => undefined) : undefined
  const lines = text?.split("\n")
  const valid = line && lines && line <= lines.length ? line : undefined
  const column = integer(source.column)
  return {
    line: valid,
    column: valid && column && column <= (lines?.[valid - 1]?.length ?? 0) + 1 ? column : undefined,
  }
}

export async function locate(directory: string, source?: { file: string; line?: number; column?: number }) {
  if (!source?.file || source.file.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(source.file)) return undefined
  if (!/\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|scss|sass|less)$/i.test(source.file)) return undefined
  const candidate = path.resolve(directory, source.file)
  const [root, file] = await Promise.all([
    realpath(directory).catch(() => undefined),
    realpath(candidate).catch(() => undefined),
  ])
  if (!root || !file) return undefined
  const relative = path.relative(root, file)
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) return undefined
  if (relative.split(path.sep).some((part) => part === "node_modules" || part === ".git")) return undefined
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) return undefined
  return { file: relative.split(path.sep).join("/"), ...(await coordinates(file, source, info.size)) }
}

export function capture(position: { x: number; y: number; detail?: boolean }) {
  const root = document.documentElement
  if (root.scrollHeight > innerHeight && root.clientWidth === innerWidth) {
    root.style.setProperty("scrollbar-gutter", "stable")
  }
  const node = document.elementFromPoint(position.x * innerWidth, position.y * innerHeight)
  if (!(node instanceof Element)) return undefined

  const label = (element: Element) => {
    const tag = element.tagName.toLowerCase()
    if (element.id) return `${tag}#${CSS.escape(element.id.slice(0, 120))}`
    const classes = [...element.classList].slice(0, 3).map((item) => `.${CSS.escape(item.slice(0, 60))}`)
    return `${tag}${classes.join("")}`
  }
  const locator = (element: Element) => {
    if (element.id && element.id.length <= 180) {
      const selector = `#${CSS.escape(element.id)}`
      if (document.querySelectorAll(selector).length === 1) return selector
    }
    for (const name of ["data-testid", "data-test", "data-cy", "aria-label"]) {
      const value = element.getAttribute(name)
      if (!value || value.length > 160) continue
      const selector = `${element.tagName.toLowerCase()}[${name}="${CSS.escape(value)}"]`
      if (document.querySelectorAll(selector).length === 1) return selector
    }
    return undefined
  }
  const selector = () => {
    const direct = locator(node)
    if (direct) return direct
    const path: string[] = []
    let current: Element | null = node
    while (current && path.length < 128) {
      const anchor = locator(current)
      if (anchor) {
        path.unshift(anchor)
        const value = path.join(" > ")
        return value.length <= 2048 && document.querySelectorAll(value).length === 1 ? value : undefined
      }
      const tag = current.tagName.toLowerCase()
      const siblings: Element[] = current.parentElement
        ? [...current.parentElement.children].filter((item) => item.tagName === current?.tagName)
        : []
      path.unshift(`${tag}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""}`)
      const value = path.join(" > ")
      if (value.length > 2048) return undefined
      if (document.querySelectorAll(value).length === 1) return value
      current = current.parentElement
    }
    return undefined
  }
  const identity = selector()
  if (!identity) return undefined
  const rect = node.getBoundingClientRect()
  const left = Math.max(0, Math.min(innerWidth, rect.left))
  const top = Math.max(0, Math.min(innerHeight, rect.top))
  const right = Math.max(left, Math.min(innerWidth, rect.right))
  const bottom = Math.max(top, Math.min(innerHeight, rect.bottom))
  const result = {
    tag: node.tagName.toLowerCase(),
    id: node.id.slice(0, 120) || undefined,
    classes: node.getAttribute("class")?.trim().slice(0, 180) || undefined,
    selector: identity,
    rect: {
      x: left / innerWidth,
      y: top / innerHeight,
      width: (right - left) / innerWidth,
      height: (bottom - top) / innerHeight,
    },
  }
  if (position.detail === false) return result

  const ancestry: Element[] = []
  let parent: Element | null = node
  while (parent && ancestry.length < 6) {
    ancestry.unshift(parent)
    parent = parent.parentElement
  }
  const hidden = (element: Element) => {
    if (
      element.matches(
        "script,style,noscript,template,input,textarea,select,[hidden],[aria-hidden=true],[contenteditable]:not([contenteditable=false])",
      )
    ) {
      return true
    }
    const style = getComputedStyle(element)
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0" ||
      style.contentVisibility === "hidden"
    )
  }
  const content = () => {
    const editable = node.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")
    if (editable) return editable.getAttribute("aria-label")?.slice(0, 180)
    const pending: Node[] = []
    let current: Node | null = node.firstChild
    let visits = 0
    let value = ""
    while (current && visits++ < 256 && value.length < 180) {
      if (current instanceof Element && !hidden(current) && current.firstChild) {
        if (current.nextSibling) pending.push(current.nextSibling)
        current = current.firstChild
        continue
      }
      if (current.nodeType === 3) value += (current.textContent ?? "").replace(/\s+/g, " ").slice(0, 180 - value.length)
      current = current.nextSibling ?? pending.pop() ?? null
    }
    return value.trim() || undefined
  }
  const text = content()
  const snippet = node.cloneNode(false) as Element
  const allowed = new Set([
    "id",
    "class",
    "role",
    "type",
    "name",
    "aria-label",
    "title",
    "data-testid",
    "data-test",
    "data-cy",
  ])
  for (const attribute of [...snippet.attributes]) {
    if (!allowed.has(attribute.name)) snippet.removeAttribute(attribute.name)
    else snippet.setAttribute(attribute.name, attribute.value.slice(0, 180))
  }
  snippet.textContent = text ?? ""
  const styles = getComputedStyle(node)
  const source = () => {
    const file = node.getAttribute("data-source-file")
    if (file) {
      const line = Number(node.getAttribute("data-source-line"))
      const column = Number(node.getAttribute("data-source-column"))
      return {
        file: file.slice(0, 4096),
        line: Number.isInteger(line) && line > 0 ? line : undefined,
        column: Number.isInteger(column) && column > 0 ? column : undefined,
      }
    }
    const key = Object.keys(node).find(
      (item) => item.startsWith("__reactFiber$") || item.startsWith("__reactInternalInstance$"),
    )
    if (!key) return undefined
    type Fiber = {
      _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number }
      _debugOwner?: Fiber
      return?: Fiber
    }
    let fiber: Fiber | undefined = (node as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 8; depth++) {
      const origin = fiber._debugSource
      if (origin?.fileName) {
        return { file: origin.fileName.slice(0, 4096), line: origin.lineNumber, column: origin.columnNumber }
      }
      fiber = fiber._debugOwner ?? fiber.return
    }
    return undefined
  }
  return {
    ...result,
    text,
    hierarchy: ancestry.map(label),
    html: snippet.outerHTML.slice(0, 800),
    styles: { color: styles.color.slice(0, 80), backgroundColor: styles.backgroundColor.slice(0, 80) },
    source: source(),
  }
}
