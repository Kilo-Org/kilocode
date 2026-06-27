/**
 * Stats Dialog
 *
 * Displays aggregated session usage statistics (overview, cost & tokens, model
 * usage, tool usage) for the current project. Mirrors the `kilo stats` CLI
 * output, rendered as an interactive TUI dialog.
 */

import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { formatNumber } from "@/cli/cmd/stats"
import type { StatsStatsResponse } from "@kilocode/sdk/v2"

interface DialogStatsProps {
  stats: StatsStatsResponse
}

function money(n: number | string) {
  const v = typeof n === "number" ? (isNaN(n) ? 0 : n) : Number(n)
  return `$${(isNaN(v) ? 0 : v).toFixed(2)}`
}

function num(n: number | string): number {
  return typeof n === "number" ? (isNaN(n) ? 0 : n) : Number(n)
}

export function DialogStats(props: DialogStatsProps) {
  const { theme } = useTheme()
  const dialog = useDialog()

  useKeyboard((evt: any) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  const sortedModels = () =>
    Object.entries(props.stats.modelUsage).sort(([, a], [, b]) => num(b.messages) - num(a.messages))

  const sortedTools = () =>
    Object.entries(props.stats.toolUsage).sort(([, a], [, b]) => num(b) - num(a))

  const totalToolUsage = () =>
    Object.values(props.stats.toolUsage).reduce<number>((a, b) => a + num(b), 0)

  const maxToolCount = () => {
    const tools = sortedTools()
    return tools.length ? Math.max(...tools.map(([, c]) => num(c))) : 0
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Session Statistics
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <scrollbox maxHeight={24} flexGrow={1} scrollbarOptions={{ visible: true }}>
        <box gap={1} paddingBottom={1}>
          {/* Overview */}
          <text attributes={TextAttributes.BOLD} fg={theme.primary}>
            Overview
          </text>
          <text fg={theme.text}>Sessions: {num(props.stats.totalSessions).toLocaleString()}</text>
          <text fg={theme.text}>Messages: {num(props.stats.totalMessages).toLocaleString()}</text>
          <text fg={theme.text}>Days: {num(props.stats.days).toString()}</text>

          {/* Cost & Tokens */}
          <text attributes={TextAttributes.BOLD} fg={theme.primary}>
            Cost & Tokens
          </text>
          <text fg={theme.text}>Total Cost: {money(props.stats.totalCost)}</text>
          <text fg={theme.text}>Avg Cost/Day: {money(props.stats.costPerDay)}</text>
          <text fg={theme.text}>
            Avg Tokens/Session: {formatNumber(Math.round(num(props.stats.tokensPerSession)))}
          </text>
          <text fg={theme.text}>
            Median Tokens/Session: {formatNumber(Math.round(num(props.stats.medianTokensPerSession)))}
          </text>
          <text fg={theme.text}>Input: {formatNumber(num(props.stats.totalTokens.input))}</text>
          <text fg={theme.text}>Output: {formatNumber(num(props.stats.totalTokens.output))}</text>
          <text fg={theme.text}>Cache Read: {formatNumber(num(props.stats.totalTokens.cache.read))}</text>
          <text fg={theme.text}>Cache Write: {formatNumber(num(props.stats.totalTokens.cache.write))}</text>

          {/* Model Usage */}
          {sortedModels().length > 0 && (
            <box gap={1}>
              <text attributes={TextAttributes.BOLD} fg={theme.primary}>
                Model Usage
              </text>
              <For each={sortedModels()}>
                {([model, usage]) => (
                  <box gap={0} paddingBottom={1}>
                    <text attributes={TextAttributes.BOLD} fg={theme.text}>
                      {model}
                    </text>
                    <text fg={theme.textMuted}>  Messages: {num(usage.messages).toLocaleString()}</text>
                    <text fg={theme.textMuted}>  Input Tokens: {formatNumber(num(usage.tokens.input))}</text>
                    <text fg={theme.textMuted}>  Output Tokens: {formatNumber(num(usage.tokens.output))}</text>
                    <text fg={theme.textMuted}>  Cache Read: {formatNumber(num(usage.tokens.cache.read))}</text>
                    <text fg={theme.textMuted}>  Cache Write: {formatNumber(num(usage.tokens.cache.write))}</text>
                    <text fg={theme.textMuted}>  Cost: {num(usage.cost).toFixed(4)}</text>
                  </box>
                )}
              </For>
            </box>
          )}

          {/* Tool Usage */}
          {sortedTools().length > 0 && (
            <box gap={1}>
              <text attributes={TextAttributes.BOLD} fg={theme.primary}>
                Tool Usage
              </text>
              <For each={sortedTools()}>
                {([tool, count]) => {
                  const n = num(count)
                  const max = maxToolCount()
                  const barLength = Math.max(1, Math.floor((n / max) * 20))
                  const bar = "█".repeat(barLength)
                  const total = totalToolUsage()
                  const pct = total > 0 ? ((n / total) * 100).toFixed(1) : "0.0"
                  const maxToolLength = 18
                  const truncatedTool =
                    tool.length > maxToolLength ? tool.substring(0, maxToolLength - 2) + ".." : tool
                  return (
                    <text fg={theme.text}>
                      {truncatedTool.padEnd(maxToolLength)} {bar.padEnd(20)} {n.toString().padStart(3)} (
                      {pct.padStart(4)}%)
                    </text>
                  )
                }}
              </For>
            </box>
          )}
        </box>
      </scrollbox>

      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
