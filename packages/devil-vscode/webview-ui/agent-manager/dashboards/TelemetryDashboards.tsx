/**
 * TelemetryDashboards — Agent Manager tab for team workflow telemetry.
 *
 * Renders 4 SVG charts: SuccessRate, StallRate, Cost, Duration.
 * Data fetched via teamBuilder.getAggregations → teamBuilder.aggregations message.
 * All charts are plain SVG — no charting library dependency.
 */
import { createSignal, For, Show, onMount, onCleanup, type JSX } from "solid-js"
import { useVSCode } from "../../src/context/vscode"
import type { TeamBuilderAggregationsMessage } from "../../src/types/messages"

// ---------------------------------------------------------------------------
// Aggregation data shapes (mirrors SDK team.ts types)
// ---------------------------------------------------------------------------

interface SuccessEntry {
  completed: number
  started: number
  rate: number
}

interface StallEntry {
  maxWaitMs: number
  avgWaitMs: number
}

interface CostEntry {
  workflowId: string
  totalCost: number
}

interface DurationEntry {
  avgMs: number
  p95Ms: number
  count: number
}

interface AggregationData {
  successRateByTeam: Record<string, SuccessEntry>
  stallRateByPosition: Record<string, StallEntry>
  costByWorkflow: CostEntry[]
  durationByStage: Record<string, DurationEntry>
  generatedAt: string
}

// ---------------------------------------------------------------------------
// SVG chart helpers
// ---------------------------------------------------------------------------

const SVG_W = 340
const SVG_H = 160
const BAR_H = 20
const BAR_GAP = 8
const LABEL_W = 90
const MARGIN = { top: 12, right: 12, bottom: 12, left: LABEL_W }

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ---------------------------------------------------------------------------
// SuccessRateChart — bar chart per team (completed/started ratio)
// ---------------------------------------------------------------------------

function SuccessRateChart(props: { data: Record<string, SuccessEntry> }): JSX.Element {
  const entries = () => Object.entries(props.data)
  const chartH = () => Math.max(SVG_H, entries().length * (BAR_H + BAR_GAP) + MARGIN.top + MARGIN.bottom)
  const plotW = SVG_W - MARGIN.left - MARGIN.right

  return (
    <div class="td-chart-container">
      <div class="td-chart-title">Success Rate by Team</div>
      <Show when={entries().length === 0}>
        <div class="td-chart-empty">No success rate data available.</div>
      </Show>
      <Show when={entries().length > 0}>
        <svg
          viewBox={`0 0 ${SVG_W} ${chartH()}`}
          width={SVG_W}
          height={chartH()}
          aria-label="Success rate by team"
          role="img"
        >
          <For each={entries()}>
            {([teamId, entry], i) => {
              const y = MARGIN.top + i() * (BAR_H + BAR_GAP)
              const rate = clamp(entry.rate ?? (entry.started > 0 ? entry.completed / entry.started : 0), 0, 1)
              const barW = Math.round(rate * plotW)
              const pct = Math.round(rate * 100)
              return (
                <>
                  <text
                    x={MARGIN.left - 6}
                    y={y + BAR_H / 2 + 4}
                    text-anchor="end"
                    font-size="11"
                    fill="var(--vscode-foreground, #ccc)"
                    class="td-chart-label"
                  >
                    {teamId.length > 12 ? teamId.slice(0, 11) + "…" : teamId}
                  </text>
                  <rect
                    x={MARGIN.left}
                    y={y}
                    width={plotW}
                    height={BAR_H}
                    fill="var(--vscode-input-background, #2a2a2a)"
                    rx="3"
                  />
                  <rect
                    x={MARGIN.left}
                    y={y}
                    width={barW}
                    height={BAR_H}
                    fill={pct >= 80 ? "#3a8a55" : pct >= 50 ? "#8a7a3a" : "#8a3a3a"}
                    rx="3"
                  />
                  <text
                    x={MARGIN.left + barW + 4}
                    y={y + BAR_H / 2 + 4}
                    font-size="11"
                    fill="var(--vscode-foreground, #ccc)"
                  >
                    {pct}%
                  </text>
                </>
              )
            }}
          </For>
        </svg>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StallRateChart — horizontal bars for max wait per position; color-coded
// ---------------------------------------------------------------------------

function StallRateChart(props: { data: Record<string, StallEntry> }): JSX.Element {
  const entries = () => Object.entries(props.data)
  const maxMs = () => Math.max(...entries().map(([, v]) => v.maxWaitMs), 1)
  const chartH = () => Math.max(SVG_H, entries().length * (BAR_H + BAR_GAP) + MARGIN.top + MARGIN.bottom)
  const plotW = SVG_W - MARGIN.left - MARGIN.right

  return (
    <div class="td-chart-container">
      <div class="td-chart-title">Stall Rate by Position</div>
      <Show when={entries().length === 0}>
        <div class="td-chart-empty">No stall rate data available.</div>
      </Show>
      <Show when={entries().length > 0}>
        <svg
          viewBox={`0 0 ${SVG_W} ${chartH()}`}
          width={SVG_W}
          height={chartH()}
          aria-label="Stall rate by position"
          role="img"
        >
          <For each={entries()}>
            {([posId, entry], i) => {
              const y = MARGIN.top + i() * (BAR_H + BAR_GAP)
              const maxWait = entry.maxWaitMs ?? 0
              const barW = Math.round((maxWait / maxMs()) * plotW)
              const fillColor = maxWait > 60000 ? "#8a3a3a" : maxWait > 30000 ? "#8a7a3a" : "#3a8a55"
              const label = maxWait >= 1000 ? `${(maxWait / 1000).toFixed(1)}s` : `${maxWait}ms`
              return (
                <>
                  <text
                    x={MARGIN.left - 6}
                    y={y + BAR_H / 2 + 4}
                    text-anchor="end"
                    font-size="11"
                    fill="var(--vscode-foreground, #ccc)"
                  >
                    {posId.length > 12 ? posId.slice(0, 11) + "…" : posId}
                  </text>
                  <rect
                    x={MARGIN.left}
                    y={y}
                    width={plotW}
                    height={BAR_H}
                    fill="var(--vscode-input-background, #2a2a2a)"
                    rx="3"
                  />
                  <rect x={MARGIN.left} y={y} width={barW} height={BAR_H} fill={fillColor} rx="3" />
                  <text
                    x={MARGIN.left + barW + 4}
                    y={y + BAR_H / 2 + 4}
                    font-size="11"
                    fill="var(--vscode-foreground, #ccc)"
                  >
                    {label}
                  </text>
                </>
              )
            }}
          </For>
        </svg>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CostChart — list/bar per workflow
// ---------------------------------------------------------------------------

function CostChart(props: { data: CostEntry[] }): JSX.Element {
  const entries = () => props.data
  const allZero = () => entries().every((e) => e.totalCost === 0)
  const maxCost = () => Math.max(...entries().map((e) => e.totalCost), 0.0001)
  const chartH = () => Math.max(SVG_H, entries().length * (BAR_H + BAR_GAP) + MARGIN.top + MARGIN.bottom)
  const plotW = SVG_W - MARGIN.left - MARGIN.right

  return (
    <div class="td-chart-container">
      <div class="td-chart-title">Cost by Workflow</div>
      <Show when={entries().length === 0 || allZero()}>
        <div class="td-chart-empty">Cost data unavailable.</div>
      </Show>
      <Show when={entries().length > 0 && !allZero()}>
        <svg
          viewBox={`0 0 ${SVG_W} ${chartH()}`}
          width={SVG_W}
          height={chartH()}
          aria-label="Cost by workflow"
          role="img"
        >
          <For each={entries()}>
            {(entry, i) => {
              const y = MARGIN.top + i() * (BAR_H + BAR_GAP)
              const barW = Math.round((entry.totalCost / maxCost()) * plotW)
              const label = `$${entry.totalCost.toFixed(4)}`
              return (
                <>
                  <text
                    x={MARGIN.left - 6}
                    y={y + BAR_H / 2 + 4}
                    text-anchor="end"
                    font-size="11"
                    fill="var(--vscode-foreground, #ccc)"
                  >
                    {entry.workflowId.length > 12 ? entry.workflowId.slice(0, 11) + "…" : entry.workflowId}
                  </text>
                  <rect
                    x={MARGIN.left}
                    y={y}
                    width={plotW}
                    height={BAR_H}
                    fill="var(--vscode-input-background, #2a2a2a)"
                    rx="3"
                  />
                  <rect x={MARGIN.left} y={y} width={barW} height={BAR_H} fill="#4a7aaa" rx="3" />
                  <text
                    x={MARGIN.left + barW + 4}
                    y={y + BAR_H / 2 + 4}
                    font-size="11"
                    fill="var(--vscode-foreground, #ccc)"
                  >
                    {label}
                  </text>
                </>
              )
            }}
          </For>
        </svg>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DurationChart — grouped bars for avg duration per stage (7 segments)
// ---------------------------------------------------------------------------

const STAGE_COLORS = ["#5a7aaa", "#5a9a6a", "#aa7a5a", "#7a5aaa", "#aa5a6a", "#5aaaaa", "#aa9a5a"]

function DurationChart(props: { data: Record<string, DurationEntry> }): JSX.Element {
  const entries = () => Object.entries(props.data)
  const maxMs = () => Math.max(...entries().map(([, v]) => v.avgMs), 1)
  const plotW = SVG_W - MARGIN.left - MARGIN.right
  const barW = () => (entries().length > 0 ? Math.floor(plotW / entries().length) - 4 : 20)
  const plotH = SVG_H - MARGIN.top - MARGIN.bottom

  return (
    <div class="td-chart-container">
      <div class="td-chart-title">Avg Duration by Stage</div>
      <Show when={entries().length === 0}>
        <div class="td-chart-empty">No duration data available.</div>
      </Show>
      <Show when={entries().length > 0}>
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          width={SVG_W}
          height={SVG_H}
          aria-label="Average duration by stage"
          role="img"
        >
          <For each={entries()}>
            {([stage, entry], i) => {
              const x = MARGIN.left + i() * (barW() + 4)
              const barH = Math.round((entry.avgMs / maxMs()) * plotH)
              const y = MARGIN.top + plotH - barH
              const label = entry.avgMs >= 1000 ? `${(entry.avgMs / 1000).toFixed(1)}s` : `${entry.avgMs}ms`
              const color = STAGE_COLORS[i() % STAGE_COLORS.length]!
              return (
                <>
                  <rect x={x} y={y} width={barW()} height={barH} fill={color} rx="2" />
                  <text
                    x={x + barW() / 2}
                    y={MARGIN.top + plotH + 10}
                    text-anchor="middle"
                    font-size="9"
                    fill="var(--vscode-foreground, #ccc)"
                  >
                    {stage.length > 5 ? stage.slice(0, 4) + "." : stage}
                  </text>
                  <text
                    x={x + barW() / 2}
                    y={y - 2}
                    text-anchor="middle"
                    font-size="9"
                    fill="var(--vscode-foreground, #ccc)"
                  >
                    {label}
                  </text>
                </>
              )
            }}
          </For>
        </svg>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TelemetryDashboards — main export
// ---------------------------------------------------------------------------

export function TelemetryDashboards(): JSX.Element {
  const vscode = useVSCode()
  const [data, setData] = createSignal<AggregationData | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const requestAggregations = () => {
    setLoading(true)
    setError(null)
    vscode.postMessage({ type: "teamBuilder.getAggregations" })
  }

  onMount(() => {
    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "teamBuilder.aggregations") {
        const m = msg as TeamBuilderAggregationsMessage
        setData((m.data as AggregationData) ?? null)
        setLoading(false)
        return
      }
      if (msg.type === "teamBuilder.error") {
        setError((msg as { message: string }).message)
        setLoading(false)
        return
      }
    })

    requestAggregations()
    onCleanup(unsub)
  })

  return (
    <div class="td-layout">
      <div class="td-header">
        <span class="td-title">Team Telemetry</span>
        <button class="td-refresh-btn" onClick={requestAggregations} disabled={loading()}>
          {loading() ? "Loading…" : "Refresh"}
        </button>
        <Show when={data()}>
          <span class="td-generated-at">as of {data()!.generatedAt}</span>
        </Show>
      </div>

      <Show when={error()}>
        <div class="td-error">{error()}</div>
      </Show>

      <Show when={!data() && !loading() && !error()}>
        <div class="td-empty">No data available — click Refresh to load.</div>
      </Show>

      <Show when={data()}>
        <div class="td-charts-grid">
          <SuccessRateChart data={data()!.successRateByTeam} />
          <StallRateChart data={data()!.stallRateByPosition} />
          <CostChart data={data()!.costByWorkflow} />
          <DurationChart data={data()!.durationByStage} />
        </div>
      </Show>
    </div>
  )
}
