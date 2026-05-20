/**
 * cost-tracker.ts — Token usage & USD cost per model (session-scoped)
 * Deps: none (pure TS)
 * Ported from Claude Code cost-tracker.ts
 */

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  server_tool_use?: { web_search_requests?: number }
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

interface CostState {
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  totalDuration: number
  lastDuration: number | undefined
  modelUsage: Record<string, ModelUsage>
}

function empty(): CostState {
  return {
    totalCostUSD: 0, totalAPIDuration: 0, totalAPIDurationWithoutRetries: 0,
    totalToolDuration: 0, totalLinesAdded: 0, totalLinesRemoved: 0,
    totalDuration: 0, lastDuration: undefined, modelUsage: {},
  }
}

const state: CostState = empty()

export function reset() { Object.assign(state, empty()) }
export function getTotalCost() { return state.totalCostUSD }
export function getDuration() { return state.totalDuration }
export function getAPIDuration() { return state.totalAPIDuration }
export function getLines() { return { added: state.totalLinesAdded, removed: state.totalLinesRemoved } }
export function getModelUsage() { return state.modelUsage }
export function getUsageForModel(model: string) { return state.modelUsage[model] }
export function addLines(added: number, removed: number) {
  state.totalLinesAdded += added; state.totalLinesRemoved += removed
}
export function addAPIDuration(ms: number, withoutRetries: number) {
  state.totalAPIDuration += ms; state.totalAPIDurationWithoutRetries += withoutRetries
}
export function addToolDuration(ms: number) { state.totalToolDuration += ms }

export function addSessionCost(cost: number, usage: TokenUsage, model: string): number {
  if (!state.modelUsage[model]) {
    state.modelUsage[model] = {
      inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0, webSearchRequests: 0,
      costUSD: 0, contextWindow: 0, maxOutputTokens: 0,
    }
  }
  const m = state.modelUsage[model]
  m.inputTokens += usage.input_tokens
  m.outputTokens += usage.output_tokens
  m.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0
  m.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0
  m.webSearchRequests += usage.server_tool_use?.web_search_requests ?? 0
  m.costUSD += cost
  state.totalCostUSD += cost
  return cost
}

export function formatCost(cost: number, decimals = 4) {
  return `$${cost > 0.5 ? cost.toFixed(2) : cost.toFixed(decimals)}`
}

function fmtDur(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
}

function fmtNum(n: number) { return n.toLocaleString() }

export function formatTotalCost() {
  const l = state
  const usageLines = Object.keys(l.modelUsage).length === 0
    ? "Usage:                 0 input, 0 output, 0 cache read, 0 cache write"
    : [
        "Usage by model:",
        ...Object.entries(l.modelUsage).map(([model, u]) =>
          `${model}:`.padStart(21) +
          `${fmtNum(u.inputTokens)} input, ${fmtNum(u.outputTokens)} output, ` +
          `${fmtNum(u.cacheReadInputTokens)} cache read, ${fmtNum(u.cacheCreationInputTokens)} cache write` +
          (u.webSearchRequests > 0 ? `, ${fmtNum(u.webSearchRequests)} web search` : "") +
          ` (${formatCost(u.costUSD)})`
        ),
      ].join("\n")
  return [
    `Total cost:            ${formatCost(l.totalCostUSD)}`,
    `Total duration (API):  ${fmtDur(l.totalAPIDuration)}`,
    `Total duration (wall): ${fmtDur(l.totalDuration)}`,
    `Total code changes:    ${l.totalLinesAdded} ${l.totalLinesAdded === 1 ? "line" : "lines"} added, ${l.totalLinesRemoved} ${l.totalLinesRemoved === 1 ? "line" : "lines"} removed`,
    usageLines,
  ].join("\n")
}
