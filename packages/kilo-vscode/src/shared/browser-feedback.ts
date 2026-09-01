import { partReview, type ReviewMessageData } from "./review-comments"

export interface BrowserReference {
  id: string
  sessionId: string
  selector: string
  text?: string
  url?: string
  title?: string
  hierarchy?: string[]
  html?: string
  styles?: { color?: string; backgroundColor?: string }
  source?: { file: string; line?: number; column?: number }
  content?: string
}

export interface BrowserFeedbackData {
  version: 1
  references: BrowserReference[]
}

export interface FeedbackView {
  review?: ReviewMessageData
  browserFeedback?: BrowserFeedbackData
  body: string
}

const REFERENCE_LIMIT = 20
const HIERARCHY_LIMIT = 20
const TOTAL_LIMIT = 200_000
const ID_LIMIT = 512
const SESSION_LIMIT = 512
const SELECTOR_LIMIT = 4_096
const TEXT_LIMIT = 20_000
const URL_LIMIT = 4_096
const TITLE_LIMIT = 2_000
const HIERARCHY_ITEM_LIMIT = 512
const HTML_LIMIT = 20_000
const STYLE_LIMIT = 256
const SOURCE_LIMIT = 4_096

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function string(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || value.length > limit) return undefined
  return value
}

function optionalString(value: unknown, limit: number): string | false | undefined {
  if (value === undefined) return undefined
  const result = string(value, limit)
  return result === undefined ? false : result
}

function safePath(value: string): boolean {
  const absolute = value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)
  return !absolute && !value.split(/[\\/]/).includes("..") && !value.includes("\0")
}

function url(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
    parsed.username = ""
    parsed.password = ""
    parsed.search = ""
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return undefined
  }
}

function optionalUrl(value: unknown): string | false | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length > URL_LIMIT) return false
  const result = url(value)
  return result === undefined ? false : result
}

function positive(value: unknown): number | false | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return false
  return value
}

function styles(value: unknown): BrowserReference["styles"] | false | undefined {
  if (value === undefined) return undefined
  const item = record(value)
  if (!item) return false
  const color = optionalString(item.color, STYLE_LIMIT)
  const backgroundColor = optionalString(item.backgroundColor, STYLE_LIMIT)
  if (color === false || backgroundColor === false) return false
  if (color === undefined && backgroundColor === undefined) return undefined
  return {
    ...(color === undefined ? {} : { color }),
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
  }
}

function source(value: unknown): BrowserReference["source"] | false | undefined {
  if (value === undefined) return undefined
  const item = record(value)
  if (!item) return false
  const file = string(item.file, SOURCE_LIMIT)
  const line = positive(item.line)
  const column = positive(item.column)
  if (!file || !safePath(file) || line === false || column === false) return false
  return {
    file,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  }
}

function hierarchy(value: unknown): string[] | false | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > HIERARCHY_LIMIT) return false
  const result = value.map((item) => string(item, HIERARCHY_ITEM_LIMIT))
  if (result.some((item) => item === undefined)) return false
  return result as string[]
}

function reference(value: unknown): BrowserReference | undefined {
  const item = record(value)
  if (!item) return undefined
  const id = string(item.id, ID_LIMIT)
  const sessionId = string(item.sessionId, SESSION_LIMIT)
  const selector = string(item.selector, SELECTOR_LIMIT)
  if (!id || !sessionId || !selector) return undefined
  const text = optionalString(item.text, TEXT_LIMIT)
  const pageUrl = optionalUrl(item.url)
  const title = optionalString(item.title, TITLE_LIMIT)
  const tree = hierarchy(item.hierarchy)
  const html = optionalString(item.html, HTML_LIMIT)
  const style = styles(item.styles)
  const verified = source(item.source)
  const content = item.content === undefined ? undefined : optionalString(item.content, 100_000)
  if (!valid([text, pageUrl, title, tree, html, style, verified, content])) return undefined
  const safeText = unwrap(text)
  const safeUrl = unwrap(pageUrl)
  const safeTitle = unwrap(title)
  const safeTree = unwrap(tree)
  const safeHtml = unwrap(html)
  const safeStyle = unwrap(style)
  const safeSource = unwrap(verified)
  const safeContent = unwrap(content)
  return {
    id,
    sessionId,
    selector,
    ...(safeText === undefined ? {} : { text: safeText }),
    ...(safeUrl === undefined ? {} : { url: safeUrl }),
    ...(safeTitle === undefined ? {} : { title: safeTitle }),
    ...(safeTree === undefined ? {} : { hierarchy: safeTree }),
    ...(safeHtml === undefined ? {} : { html: safeHtml }),
    ...(safeStyle === undefined ? {} : { styles: safeStyle }),
    ...(safeSource === undefined ? {} : { source: safeSource }),
    ...(safeContent === undefined ? {} : { content: safeContent }),
  }
}

function valid(
  values: Array<string | string[] | BrowserReference["styles"] | BrowserReference["source"] | false | undefined>,
): boolean {
  return !values.some((item) => item === false)
}

function unwrap<T>(item: T | false | undefined): T | undefined {
  return item === false ? undefined : item
}

function weight(item: BrowserReference): number {
  return JSON.stringify(item).length
}

function normalize(references: readonly BrowserReference[]): BrowserReference[] | undefined {
  if (references.length === 0 || references.length > REFERENCE_LIMIT) return undefined
  const result = references.map(reference)
  if (result.some((item) => item === undefined)) return undefined
  const list = result as BrowserReference[]
  if (list.reduce((total, item) => total + weight(item), 0) > TOTAL_LIMIT) return undefined
  return list
}

function escapeInline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]{}()#+\-!|<>])/g, "\\$1")
}

function fenced(value: string): string[] {
  const matches = value.match(/`+/g) ?? []
  const longest = matches.reduce((max, item) => Math.max(max, item.length), 0)
  const fence = "`".repeat(Math.max(3, longest + 1))
  return [fence, value, fence]
}

function page(item: BrowserReference): string | undefined {
  if (!item.url && !item.title) return undefined
  return `Page: ${item.title ? escapeInline(item.title) : "Untitled"}${item.url ? ` (\`${escapeInline(item.url)}\`)` : ""}`
}

function detail(item: BrowserReference, index: number, first: BrowserReference): string[] {
  const lines = [`Element ${index + 1}:`, ...fenced(item.selector)]
  if (index > 0 && (item.url !== first.url || item.title !== first.title)) {
    const value = page(item)
    if (value) lines.push(value)
  }
  if (item.hierarchy?.length) lines.push(...["DOM:", ...fenced(item.hierarchy.join(" > "))])
  if (item.text && (!item.html || item.html === item.text)) lines.push(...[`Text:`, ...fenced(item.text)])
  if (item.html && item.html !== item.text) lines.push(...[`HTML:`, ...fenced(item.html)])
  if (item.styles) {
    const values = [
      item.styles.color ? `color=${escapeInline(item.styles.color)}` : "",
      item.styles.backgroundColor ? `background=${escapeInline(item.styles.backgroundColor)}` : "",
    ].filter(Boolean)
    if (values.length) lines.push(`Styles: ${values.join(", ")}`)
  }
  if (item.source) {
    const location = [item.source.file, item.source.line, item.source.column]
      .filter((value) => value !== undefined)
      .join(":")
    lines.push(...[`Source:`, ...fenced(location)])
  }
  return lines
}

export function formatBrowserFeedback(references: BrowserReference[]): string {
  const list = normalize(references) ?? []
  if (list.length === 0) return "## Browser Feedback"
  const lines = ["## Browser Feedback", ""]
  const heading = page(list[0]!)
  if (heading) lines.push(heading, "")
  list.forEach((item, index) => lines.push(...detail(item, index, list[0]!), ""))
  return lines.join("\n").trimEnd()
}

function view(value: unknown, content: string): { data: BrowserFeedbackData; body: string } | undefined {
  const data = record(value)
  if (!data || data.version !== 1 || !Array.isArray(data.references)) return undefined
  const references = data.references.map(reference)
  if (references.length === 0 || references.length > REFERENCE_LIMIT || references.some((item) => item === undefined))
    return undefined
  const list = (references as BrowserReference[]).map((item) => {
    const result = { ...item }
    delete result.content
    return result
  })
  if (list.reduce((total, item) => total + weight(item), 0) > TOTAL_LIMIT) return undefined
  const prefix = formatBrowserFeedback(list)
  if (content === prefix) return { data: { version: 1, references: list }, body: "" }
  if (!content.startsWith(`${prefix}\n\n`)) return undefined
  return { data: { version: 1, references: list }, body: content.slice(prefix.length + 2) }
}

export function browserFeedbackData(references: BrowserReference[]): BrowserFeedbackData | undefined {
  const list = normalize(references)
  if (!list) return undefined
  return {
    version: 1,
    references: list.map((item) => {
      const result = { ...item }
      delete result.content
      return result
    }),
  }
}

export function mergeBrowserReferences(current: BrowserReference[], incoming: BrowserReference): BrowserReference[] {
  const selected = browserFeedbackData([incoming])?.references[0]
  if (!selected) return current
  const kept = current.filter(
    (item) => item.id !== selected.id && (item.selector !== selected.selector || item.url !== selected.url),
  )
  if (kept.length >= REFERENCE_LIMIT) return current
  return [...kept, selected]
}

export function browserFeedbackMetadata(data: BrowserFeedbackData): Record<string, unknown> {
  return { kilo: { browserFeedback: data } }
}

export function parseBrowserFeedback(value: unknown, content: string): BrowserFeedbackData | undefined {
  return view(value, content)?.data
}

export function feedbackMetadata(
  review: ReviewMessageData | undefined,
  browserFeedback: BrowserFeedbackData | undefined,
): Record<string, unknown> | undefined {
  if (!review && !browserFeedback) return undefined
  return {
    kilo: {
      ...(review ? { review } : {}),
      ...(browserFeedback ? { browserFeedback } : {}),
    },
  }
}

export function partFeedback(metadata: unknown, content: string): FeedbackView | undefined {
  const root = record(metadata)
  const kilo = record(root?.kilo)
  const reviewValue = kilo?.review
  const browserValue = kilo?.browserFeedback
  let body = content
  let review: ReviewMessageData | undefined
  let browserFeedback: BrowserFeedbackData | undefined
  if (reviewValue !== undefined) {
    const parsed = partReview({ kilo: { review: reviewValue } }, body)
    if (!parsed) return undefined
    review = parsed.data
    body = parsed.body
  }
  if (browserValue !== undefined) {
    const parsed = view(browserValue, body)
    if (!parsed) return undefined
    browserFeedback = parsed.data
    body = parsed.body
  }
  if (!review && !browserFeedback) return undefined
  return { review, browserFeedback, body }
}

export function parseFeedback(
  metadata: { review?: unknown; browserFeedback?: unknown },
  content: string,
): Pick<FeedbackView, "review" | "browserFeedback"> | undefined {
  const parsed = partFeedback({ kilo: metadata }, content)
  if (!parsed) return undefined
  return { review: parsed.review, browserFeedback: parsed.browserFeedback }
}
