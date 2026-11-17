import type { Observation } from "./settings"

export type Section = { title: string; lines: string[] }
export type Snapshot = { url?: string; title?: string; lines: string[] }
export type Change = { added: string[]; removed: string[]; changed: { from: string; to: string }[] }

const fence = "```"

export function split(text: string): Section[] {
  const sections: Section[] = []
  let current: Section | undefined
  let fenced = false
  for (const line of text.split("\n")) {
    if (line.startsWith(fence)) {
      if (!current) {
        current = { title: "", lines: [] }
        sections.push(current)
      }
      current.lines.push(line)
      fenced = !fenced
      continue
    }
    const title = !fenced && line.startsWith("### ") ? line.slice(4).trim() : undefined
    if (title) {
      current = { title, lines: [] }
      sections.push(current)
      continue
    }
    if (!current) {
      current = { title: "", lines: [] }
      sections.push(current)
    }
    current.lines.push(line)
  }
  return sections
}

function trim(lines: string[]) {
  const start = lines.findIndex((line) => line.trim() !== "")
  if (start === -1) return []
  const end = lines.findLastIndex((line) => line.trim() !== "")
  return lines.slice(start, end + 1)
}

export function render(sections: Section[]): string {
  return sections
    .flatMap((section) => {
      const lines = trim(section.lines)
      if (!section.title) return lines
      if (!lines.length) return []
      return [`### ${section.title}`, ...lines]
    })
    .join("\n")
}

function field(lines: string[], name: string) {
  const line = lines.find((item) => item.startsWith(`- ${name}: `))
  return line?.slice(name.length + 4)
}

export function snapshot(sections: Section[]): Snapshot | undefined {
  const page = sections.find((section) => section.title === "Page")
  const body = sections.find((section) => section.title === "Snapshot")
  const url = page && field(page.lines, "Page URL")
  const title = page && field(page.lines, "Page Title")
  if (!body) return url || title ? { url, title, lines: [] } : undefined
  const inner = trim(body.lines).filter((line) => !line.startsWith(fence))
  if (inner.length === 1 && /^- \[Snapshot\]\(/.test(inner[0])) {
    return { url, title, lines: [] }
  }
  return { url, title, lines: inner }
}

function operations(previous: string[], next: string[]) {
  const rows = previous.length + 1
  const columns = next.length + 1
  const table = new Uint32Array(rows * columns)
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] =
        previous[i] === next[j]
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1])
    }
  }
  const ops: { op: "equal" | "remove" | "add"; line: string }[] = []
  let i = 0
  let j = 0
  while (i < previous.length && j < next.length) {
    if (previous[i] === next[j]) {
      ops.push({ op: "equal", line: previous[i] })
      i += 1
      j += 1
      continue
    }
    if (table[(i + 1) * columns + j] >= table[i * columns + j + 1]) {
      ops.push({ op: "remove", line: previous[i] })
      i += 1
      continue
    }
    ops.push({ op: "add", line: next[j] })
    j += 1
  }
  while (i < previous.length) {
    ops.push({ op: "remove", line: previous[i] })
    i += 1
  }
  while (j < next.length) {
    ops.push({ op: "add", line: next[j] })
    j += 1
  }
  return ops
}

/** Line diff turned into added, changed and removed groups. A replaced line is a changed line. */
export function diff(previous: string[], next: string[]): Change {
  const result: Change = { added: [], removed: [], changed: [] }
  const ops = operations(previous, next)
  let removes: string[] = []
  let adds: string[] = []
  const flush = () => {
    const pairs = Math.min(removes.length, adds.length)
    for (let index = 0; index < pairs; index += 1) {
      result.changed.push({ from: removes[index], to: adds[index] })
    }
    result.removed.push(...removes.slice(pairs))
    result.added.push(...adds.slice(pairs))
    removes = []
    adds = []
  }
  for (const op of ops) {
    if (op.op === "remove") removes.push(op.line)
    if (op.op === "add") adds.push(op.line)
    if (op.op === "equal") flush()
  }
  flush()
  return result
}

function changes(change: Change): string[] {
  if (!change.added.length && !change.removed.length && !change.changed.length) return ["- No snapshot changes"]
  const size = [
    change.added.length ? `added ${change.added.length}` : "",
    change.changed.length ? `changed ${change.changed.length}` : "",
    change.removed.length ? `removed ${change.removed.length}` : "",
  ].filter(Boolean)
  return [
    `- ${size.join(", ")}`,
    fence + "diff",
    ...change.changed.map((item) => `~ ${item.from}\n${item.to}`),
    ...change.added.map((line) => `+ ${line}`),
    ...change.removed.map((line) => `- ${line}`),
    fence,
  ]
}

/**
 * Rewrites one upstream tool result for the configured observation mode.
 *
 * full: unchanged. diff: the post-action snapshot becomes a line diff against the previous
 * snapshot, plus new console errors supplied by the caller. none: status, URL and title only.
 */
export function observe(input: {
  mode: Observation
  text: string
  previous?: Snapshot
  consoleErrors?: string[]
}): { text: string; snapshot?: Snapshot } {
  const sections = split(input.text)
  const next = snapshot(sections)
  if (input.mode === "full") return { text: input.text, snapshot: next }

  if (input.mode === "none") {
    const page = sections.find((section) => section.title === "Page")
    const kept = sections
      .filter((section) => section.title === "Error" || section.title === "Result")
      .filter((section) => trim(section.lines).length > 0)
    return {
      text: render([
        {
          title: "Status",
          lines: [`- ${sections.some((section) => section.title === "Error") ? "error" : "ok"}`, ...(page?.lines ?? [])],
        },
        ...kept,
      ]),
    }
  }

  const kept = sections.filter(
    (section) => section.title !== "Snapshot" && section.title !== "Ran Playwright code" && section.title !== "Open tabs",
  )
  const out = [...kept]
  if (next && next.lines.length) {
    out.push(
      input.previous && input.previous.lines.length
        ? { title: "Page changes", lines: changes(diff(input.previous.lines, next.lines)) }
        : { title: "Snapshot", lines: [fence + "yaml", ...next.lines, fence] },
    )
  }
  if (input.consoleErrors?.length) out.push({ title: "Console errors", lines: input.consoleErrors })
  return { text: render(out), snapshot: next && next.lines.length ? next : input.previous ?? next }
}

type SessionState = {
  active?: Snapshot
  tabs: Map<string, Snapshot>
  console: Set<string>
}

const CONSOLE_SEEN_LIMIT = 500

/** Per-session, per-tab snapshot memory used by diff mode. */
export class Tracker {
  private readonly sessions = new Map<string, SessionState>()

  private state(session: string) {
    const existing = this.sessions.get(session)
    if (existing) return existing
    const created: SessionState = { tabs: new Map(), console: new Set() }
    this.sessions.set(session, created)
    return created
  }

  /** The snapshot the next result is compared against, or undefined on the first visit. */
  previous(session: string, tool: string, url?: string): Snapshot | undefined {
    const state = this.state(session)
    const known = url ? state.tabs.get(url) : undefined
    if (known) return known
    if (!state.active) return undefined
    if (!url) return state.active
    // Navigation keeps the tab and changes its URL, so the old snapshot is still the baseline.
    if (tool === "browser_navigate" || tool === "browser_navigate_back") return state.active
    if (state.active.url === url) return state.active
    return undefined
  }

  record(session: string, snapshot: Snapshot) {
    if (!snapshot.lines.length) return
    const state = this.state(session)
    state.active = snapshot
    if (snapshot.url) state.tabs.set(snapshot.url, snapshot)
  }

  /** Console messages not returned to the model before in this session. */
  consoleErrors(session: string, text: string): string[] {
    const state = this.state(session)
    const fresh = split(text)
      .filter((section) => section.title === "Result")
      .flatMap((section) => trim(section.lines))
      .filter((line) => line.trim() !== "")
      .filter((line) => !line.startsWith("Total messages:") && !line.startsWith("Returning "))
    const unseen = fresh.filter((line) => !state.console.has(line))
    for (const line of unseen) {
      state.console.add(line)
      if (state.console.size > CONSOLE_SEEN_LIMIT) {
        const first = state.console.values().next().value
        if (first !== undefined) state.console.delete(first)
      }
    }
    return unseen
  }
}
