// Pure turn-status helpers for the v2 assistant footer. The semantics mirror the
// TUI (`packages/tui/src/routes/session/rows.ts`): a turn starts at the nearest
// user or synthetic input, and its rate weights each model-generation step by
// the step's active streamed duration.
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { localeToBcp47, type Locale } from "../context/language-utils"

/** Finish time and, when the turn input is known, its duration in milliseconds. */
export interface TurnTiming {
  completedAt: number
  durationMs?: number
}

/** The footer metadata of one turn: its carrier step, timing and weighted rate. */
export interface TurnMetadata {
  carrierID: string
  timing: TurnTiming
  tokensPerSecond: number | undefined
}

/** One turn's message range, with the metadata its carrier row displays. */
export interface MessageTurnRange {
  start: number
  end: number
  /** Stable identity of the turn: its first input, or its first message when the input is outside the loaded page. */
  turn: string
  metadata?: TurnMetadata
}

/** True when the step ends the turn: an error, or a finish that is not an intermediate hand-off. */
export function terminalStep(message: SessionMessageAssistant): boolean {
  if (message.error) return true
  return !!message.finish && message.finish !== "tool-calls" && message.finish !== "unknown"
}

/** Finish time and, when the turn input is known, its duration in milliseconds. */
export function turnTiming(
  message: SessionMessageAssistant,
  messages: readonly SessionMessageInfo[],
): TurnTiming | undefined {
  const index = messages.findIndex((item) => item.id === message.id)
  return timingAt(messages, index, legacyTurns(messages), message)
}

/** Weighted text-generation rate across the turn's steps, output plus reasoning over streamed time. */
export function turnTokensPerSecond(
  message: SessionMessageAssistant,
  messages: readonly SessionMessageInfo[],
): number | undefined {
  const index = messages.findIndex((item) => item.id === message.id)
  return tokensAt(messages, index, legacyTurns(messages))
}

/**
 * The footer metadata of the turn that contains `message`: the turn's terminal
 * step drives the timing and rate, while the last text-bearing step carries them.
 * The clock survives an input outside the loaded page; the duration and rate do
 * not. Returns undefined until the terminal completes.
 */
export function turnMetadata(
  message: SessionMessageAssistant,
  messages: readonly SessionMessageInfo[],
): TurnMetadata | undefined {
  const index = messages.findIndex((item) => item.id === message.id)
  if (index === -1) return undefined
  return metadataAt(messages, index, legacyTurns(messages))
}

/**
 * Splits the transcript into turns once and derives each turn's metadata in the
 * same pass, so a list update never rescans the message array per row.
 */
export function messageTurnRanges(messages: readonly SessionMessageInfo[]): MessageTurnRange[] {
  const legacy = legacyTurns(messages)
  const ranges: MessageTurnRange[] = []
  let start = 0
  for (let end = 0; end <= messages.length; end++) {
    const boundary =
      end === messages.length || (legacy ? end > start && isInput(messages[end]) : messages[end].type === "idle")
    if (!boundary) continue
    if (end > start) {
      ranges.push({
        start,
        end,
        turn: turnID(messages, start, end),
        metadata: metadataAt(messages, lastAssistantIndex(messages, start, end), legacy),
      })
    }
    start = legacy ? end : end + 1
  }
  return ranges
}

/** Format a text-generation rate, for example `1,166.2 t/s`. */
export function formatTokenThroughput(value: number, locale: Locale): string {
  return new Intl.NumberFormat(localeToBcp47(locale), { maximumFractionDigits: 1 }).format(value) + " t/s"
}

function timingAt(
  messages: readonly SessionMessageInfo[],
  index: number,
  legacy: boolean,
  message: SessionMessageAssistant,
): TurnTiming | undefined {
  const completedAt = message.time.completed
  if (completedAt === undefined) return undefined
  const input = messages[inputIndex(messages, index === -1 ? messages.length : index, legacy)]
  if (!input) return { completedAt }
  return { completedAt, durationMs: Math.max(0, completedAt - input.time.created) }
}

function tokensAt(messages: readonly SessionMessageInfo[], index: number, legacy: boolean): number | undefined {
  const end = index === -1 ? messages.length : index + 1
  const start = inputIndex(messages, end, legacy)
  // The turn input is outside the loaded page, so a prefix slice would show a rate for only the tail.
  if (start === -1) return undefined
  const steps: SessionMessageAssistant[] = []
  for (let i = start + 1; i < end; i++) {
    const item = messages[i]
    if (item.type === "assistant") steps.push(item)
  }
  return tokensPerSecond(steps)
}

function tokensPerSecond(steps: readonly SessionMessageAssistant[]) {
  const durations = steps.flatMap((step) =>
    step.time.streamed === undefined ? [] : [Math.max(0, step.time.streamed - step.time.created)],
  )
  if (steps.length === 0 || durations.length !== steps.length) return undefined
  const output = steps.reduce((total, step) => total + (step.tokens?.output ?? 0) + (step.tokens?.reasoning ?? 0), 0)
  const duration = durations.reduce((total, value) => total + value, 0)
  if (output <= 0 || duration <= 0) return undefined
  // Aggregate before dividing so each step is weighted by its provider-active duration.
  return output / (duration / 1_000)
}

function metadataAt(messages: readonly SessionMessageInfo[], index: number, legacy: boolean): TurnMetadata | undefined {
  if (index < 0) return undefined
  const message = messages[index]
  if (!message || message.type !== "assistant") return undefined
  const end = turnEnd(messages, index, legacy)
  const start = inputIndex(messages, index + 1, legacy)
  // Without a known turn input, start at the current turn's first step so a
  // previous turn's carrier is never borrowed.
  const lower = start >= 0 ? start + 1 : previousBoundary(messages, index)
  const steps: SessionMessageAssistant[] = []
  let terminalIndex = -1
  for (let i = lower; i < end; i++) {
    const item = messages[i]
    if (item.type !== "assistant") continue
    steps.push(item)
    terminalIndex = i
  }
  const terminal = steps.at(-1)
  if (!terminal || terminalIndex < 0) return undefined
  const completedAt = terminal.time.completed
  if (completedAt === undefined || !terminalStep(terminal)) return undefined
  const carrier = steps.findLast((step) => step.content.some((part) => part.type === "text" && !!part.text.trim()))
  if (!carrier) return undefined
  return {
    carrierID: carrier.id,
    timing: timingAt(messages, terminalIndex, legacy, terminal) ?? { completedAt },
    tokensPerSecond: start === -1 ? undefined : tokensAt(messages, terminalIndex, legacy),
  }
}

function lastAssistantIndex(messages: readonly SessionMessageInfo[], start: number, end: number) {
  for (let index = end - 1; index >= start; index--) {
    if (messages[index].type === "assistant") return index
  }
  return -1
}

function turnID(messages: readonly SessionMessageInfo[], start: number, end: number) {
  for (let index = start; index < end; index++) {
    if (isInput(messages[index])) return messages[index].id
  }
  return messages[start].id
}

function isInput(message: SessionMessageInfo) {
  return message.type === "user" || message.type === "synthetic"
}

/** A session without idle markers predates them, so a turn ends at the next prompt. */
function legacyTurns(messages: readonly SessionMessageInfo[]): boolean {
  return !messages.some((message) => message.type === "idle")
}

// Walk back only as far as the turn boundary: the nearest input in legacy
// sessions, otherwise the first input after the previous idle marker.
function inputIndex(messages: readonly SessionMessageInfo[], end: number, legacy: boolean): number {
  let input = -1
  for (let index = end - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type === "idle") return input
    if (message.type !== "user" && message.type !== "synthetic") continue
    if (legacy) return index
    input = index
  }
  return input
}

// The turn ends at the next idle, so steers stay in it. Legacy transcripts have
// no idle markers, so they end at the next prompt.
function turnEnd(messages: readonly SessionMessageInfo[], index: number, legacy: boolean): number {
  for (let i = index; i < messages.length; i++) {
    const item = messages[i]
    if (legacy ? item.type === "user" || item.type === "synthetic" : item.type === "idle") return i
  }
  return messages.length
}

// One past the last input or idle before `index`: the current turn's first step
// when the input is outside the loaded page. Prevents borrowing a previous turn.
function previousBoundary(messages: readonly SessionMessageInfo[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    const type = messages[i].type
    if (type === "idle" || type === "user" || type === "synthetic") return i + 1
  }
  return 0
}
