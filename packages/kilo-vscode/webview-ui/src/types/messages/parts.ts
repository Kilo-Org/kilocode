// Tool state for tool parts
export type ToolState =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown>; title?: string }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      metadata?: Record<string, unknown>
    }
  | { status: "error"; input: Record<string, unknown>; error: string }

// Base part interface - all parts have these fields
export interface BasePart {
  id: string
  sessionID?: string
  messageID?: string
}

// Part types from the backend
export interface TextPart extends BasePart {
  type: "text"
  text: string
  synthetic?: boolean
  time?: { start: number; end?: number }
  metadata?: Record<string, unknown>
}

export interface FilePartSource {
  type: "file"
  path: string
  text: {
    value: string
    start: number
    end: number
  }
}

export interface FilePart extends BasePart {
  type: "file"
  mime: string
  url: string
  filename?: string
  source?: FilePartSource
}

export interface ToolPart extends BasePart {
  type: "tool"
  tool: string
  state: ToolState
  metadata?: Record<string, unknown>
  callID?: string
}

export interface ReasoningPart extends BasePart {
  type: "reasoning"
  text: string
  time?: { start: number; end?: number }
}

// Step parts from the backend
export interface StepStartPart extends BasePart {
  type: "step-start"
  // Wall-clock timestamps captured at the processor when the LLM stream
  // emits `step-start`. Used by the webview to compute per-message
  // throughput as a weighted aggregate of step durations.
  time?: {
    start: number
  }
}

// Tokens-per-second throughput metrics reported by the backend on step-finish.
// Only `"computed"` is reachable today: llama.cpp surfaces
// prompt_per_second / predicted_per_second, but the upstream AI SDK drops
// them before the raw usage reaches our adapter. The `"provider"` literal is
// reserved for the follow-up that wires a metadataExtractor into the shared
// createOpenAICompatible call (see opencode/src/kilocode/session/metrics.ts).
export interface StepThroughputMetrics {
  prompt?: number
  generation?: number
  source: "computed"
}

export interface StepFinishPart extends BasePart {
  type: "step-finish"
  reason?: string
  // Wall-clock timestamps captured at the processor across the LLM step.
  // `elapsed` is the active model-generation duration in milliseconds — it
  // excludes tool execution and idle waiting — and is what the webview uses
  // to weight the throughput aggregate.
  time?: {
    start: number
    end: number
    elapsed: number
  }
  model?: {
    providerID: string
    modelID: string
  }
  generationID?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
  metrics?: StepThroughputMetrics
}

export interface CompactionPart extends BasePart {
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export type Part = TextPart | FilePart | ToolPart | ReasoningPart | StepStartPart | StepFinishPart | CompactionPart

// Part delta for streaming updates
export interface PartDelta {
  type: "text-delta"
  textDelta?: string
}

// Token usage for assistant messages
export interface TokenUsage {
  input: number
  output: number
  reasoning?: number
  cache?: { read: number; write: number }
}

// Context usage derived from the last assistant message's tokens
export interface ContextUsage {
  tokens: number
  percentage: number | null
}

export interface FileAttachment {
  mime: string
  url: string
  filename?: string
  source?: FilePartSource
}
