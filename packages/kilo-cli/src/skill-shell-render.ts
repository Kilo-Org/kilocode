import { Effect } from "effect"

export const SHELL_REGEX = /!`([^`]+)`/g
export const SKILL_SHELL_DISABLED = "[skill shell execution disabled by policy]"
export const SKILL_SHELL_UNTRUSTED = "[skill shell execution disabled for untrusted skill]"
export const MAX_COMMANDS = 32
export const MAX_OUTPUT_BYTES = 32 * 1024
export const TIMEOUT_MS = 2 * 60 * 1000
export const BUDGET_MS = 5 * 60 * 1000
export const LIMIT_NOTE = "[skill shell command limit reached]"

export interface RenderInput<E = never> {
  readonly content: string
  readonly trusted: boolean
  readonly disabled: boolean
  readonly authorize: (commands: readonly string[]) => Effect.Effect<void, E>
  readonly run: (command: string) => Effect.Effect<string, E>
}

/**
 * Renders only live `!`cmd`` placeholders. Markdown fences and longer inline-code spans remain
 * documentation. A missing result means that the original native skill output is unchanged.
 */
export function render<E>(input: RenderInput<E>) {
  return Effect.gen(function* () {
    const inert = ranges(input.content)
    const live = Array.from(input.content.matchAll(SHELL_REGEX)).filter((match) => !inert(match.index ?? 0))
    if (live.length === 0) return undefined

    const replace = (value: (command: string) => string) => rewrite(input.content, inert, value)
    if (input.disabled) return replace(() => SKILL_SHELL_DISABLED)
    if (!input.trusted) return replace(() => SKILL_SHELL_UNTRUSTED)

    const commands = Array.from(new Set(live.map((match) => match[1] ?? ""))).slice(0, MAX_COMMANDS)
    yield* input.authorize(commands)
    const outputs = new Map<string, string>()
    const deadline = Date.now() + BUDGET_MS
    for (const command of commands) {
      if (Date.now() >= deadline) {
        outputs.set(command, "[skill shell batch time budget exceeded]")
        continue
      }
      outputs.set(command, truncate(yield* input.run(command)))
    }

    return replace((command) => outputs.get(command) ?? LIMIT_NOTE)
  })
}

export function truncate(text: string) {
  const bytes = Buffer.from(text)
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) return text
  return bytes.toString("utf8", 0, MAX_OUTPUT_BYTES) + "\n[skill shell output truncated]"
}

function rewrite(content: string, inert: (index: number) => boolean, value: (command: string) => string) {
  return content.replace(SHELL_REGEX, (match, command: string, index: number) =>
    inert(index) ? match : value(command),
  )
}

function ranges(content: string): (index: number) => boolean {
  const fences = fenceSpans(content)
  const fenced = within(fences)
  const spans: Array<[number, number]> = []
  for (const chunk of chunks(content, fences)) spans.push(...pairs(chunk))
  return (index: number) => fenced(index) || within(spans)(index)
}

function fenceSpans(content: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*$/gm
  let open: { start: number; marker: string } | undefined
  for (const match of content.matchAll(fence)) {
    const marker = match[1]
    if (!marker) continue
    if (!open) {
      open = { start: match.index ?? 0, marker }
      continue
    }
    if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
      spans.push([open.start, (match.index ?? 0) + match[0].length])
      open = undefined
    }
  }
  if (open) spans.push([open.start, content.length])
  return spans
}

function chunks(content: string, cuts: Array<[number, number]>): Array<{ start: number; text: string }> {
  const out: Array<{ start: number; text: string }> = []
  const push = (from: number, to: number) => {
    const slice = content.slice(from, to)
    const blank = /\n[ \t]*\n/g
    let start = 0
    for (const match of slice.matchAll(blank)) {
      out.push({ start: from + start, text: slice.slice(start, match.index ?? 0) })
      start = (match.index ?? 0) + match[0].length
    }
    out.push({ start: from + start, text: slice.slice(start) })
  }
  let position = 0
  for (const [start, end] of cuts) {
    if (start > position) push(position, start)
    position = end
  }
  if (position < content.length) push(position, content.length)
  return out
}

function pairs(chunk: { start: number; text: string }): Array<[number, number]> {
  const runs = Array.from(chunk.text.matchAll(/`+/g)).map((match) => ({
    start: chunk.start + (match.index ?? 0),
    len: match[0].length,
  }))
  const next = Array.from({ length: runs.length }, () => -1)
  const last = new Map<number, number>()
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index]
    if (!run) continue
    next[index] = last.get(run.len) ?? -1
    last.set(run.len, index)
  }
  const out: Array<[number, number]> = []
  for (let index = 0; index < runs.length; ) {
    const run = runs[index]
    if (!run || run.len < 2 || next[index] < 0) {
      index++
      continue
    }
    const close = runs[next[index]]
    if (!close) {
      index++
      continue
    }
    out.push([run.start, close.start + close.len])
    index = next[index] + 1
  }
  return out
}

function within(spans: Array<[number, number]>): (index: number) => boolean {
  return (index: number) => {
    let low = 0
    let high = spans.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const span = spans[middle]
      if (!span) return false
      const [start, end] = span
      if (index < start) high = middle - 1
      else if (index >= end) low = middle + 1
      else return true
    }
    return false
  }
}
