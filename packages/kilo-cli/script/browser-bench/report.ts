/** Aggregation and output for the browser benchmark: one JSONL row per run, and a Markdown summary per backend. */

export type ToolError = { tool: string; name: string; text: string }

export type Row = {
  backend: string
  model: string
  observation: string
  task: string
  group: string
  run: number
  success: boolean
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  /** The cost the CLI recorded in its step events (what the endpoint reported it charged). */
  cost: number
  /** The model's list price for the recorded tokens, at the time of each step. */
  listCost: number
  turns: number
  toolCalls: number
  browserCalls: number
  /** Browser tool calls by tool name. */
  browserTools: Record<string, number>
  /** Every failed tool call the model saw, classified by the bridge error it maps to. */
  toolErrors: ToolError[]
  /** UTF-8 bytes of the text every browser tool result handed to the model, failures included. */
  resultBytes: number
  /** Images (screenshots) browser tool results handed to the model. */
  resultImages: number
  wallMs: number
  /** `/proc/loadavg` 1-minute load when the run started; the host is shared, so wall time is measured under load. */
  load: number
  /** Tabs open in the extension's browser after the run; -1 for the playwright backend. */
  tabsAfter: number
  exit: number
  answer: string
  error: string
  log: string
}

const tokensOf = (row: Row) => row.input + row.output + row.cacheRead + row.cacheWrite
const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length)
const percent = (value: number) => `${(value * 100).toFixed(1)}%`

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function countBy<T>(values: T[], key: (value: T) => string) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

const oneLine = (text: string, limit = 200) => text.replace(/\s+/g, " ").trim().slice(0, limit).replace(/\|/g, "\\|")

export function renderSummary(rows: Row[]): string {
  if (rows.length === 0) return "# Browser benchmark\n\nNo runs recorded."
  const backends = [...new Set(rows.map((row) => row.backend))]
  const groups = [...new Set(rows.map((row) => row.group))]
  const lines: string[] = []
  lines.push("# Browser benchmark")
  lines.push("")
  lines.push(
    `${rows.length} runs · ${backends.join(", ")} · ${[...new Set(rows.map((row) => row.model))].join(", ")} · ` +
      `observation ${[...new Set(rows.map((row) => row.observation))].join(", ")} · ` +
      `${new Set(rows.map((row) => row.task)).size} tasks · up to ${Math.max(...rows.map((row) => row.run))} repetitions`,
  )
  lines.push("")
  lines.push(
    "Tokens count input, output and both cache directions; non-cached tokens are input plus output. " +
      "CLI cost is what the CLI recorded (what the endpoint reported it charged; zero on a BYOK key); list cost is the " +
      "model's list price for the recorded tokens. Wall time was measured on a shared host; load is the 1-minute load " +
      "average at run start.",
  )
  lines.push("")
  lines.push("## Per backend")
  lines.push("")
  lines.push(
    "| backend | runs | success | mean tokens | mean non-cached | mean reasoning | mean turns | mean wall | median wall | mean CLI cost | mean list cost | total list cost | mean browser calls | mean tool errors | mean result KB | mean load |",
  )
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
  for (const backend of backends) {
    const subset = rows.filter((row) => row.backend === backend)
    const successes = subset.filter((row) => row.success).length
    lines.push(
      `| ${backend} | ${subset.length} | ${successes}/${subset.length} (${percent(successes / subset.length)}) | ` +
        `${Math.round(mean(subset.map(tokensOf)))} | ${Math.round(mean(subset.map((row) => row.input + row.output)))} | ` +
        `${Math.round(mean(subset.map((row) => row.reasoning)))} | ` +
        `${mean(subset.map((row) => row.turns)).toFixed(1)} | ${(mean(subset.map((row) => row.wallMs)) / 1000).toFixed(1)}s | ` +
        `${(median(subset.map((row) => row.wallMs)) / 1000).toFixed(1)}s | $${mean(subset.map((row) => row.cost)).toFixed(4)} | ` +
        `$${mean(subset.map((row) => row.listCost)).toFixed(4)} | $${subset.reduce((sum, row) => sum + row.listCost, 0).toFixed(4)} | ` +
        `${mean(subset.map((row) => row.browserCalls)).toFixed(1)} | ${mean(subset.map((row) => row.toolErrors.length)).toFixed(2)} | ` +
        `${(mean(subset.map((row) => row.resultBytes)) / 1024).toFixed(1)} | ${mean(subset.map((row) => row.load)).toFixed(1)} |`,
    )
  }
  lines.push("")
  lines.push("## Success by task group")
  lines.push("")
  lines.push(`| backend | ${groups.join(" | ")} |`)
  lines.push(`|---|${groups.map(() => "---").join("|")}|`)
  for (const backend of backends) {
    const cells = groups.map((name) => {
      const subset = rows.filter((row) => row.backend === backend && row.group === name)
      if (subset.length === 0) return "–"
      const successes = subset.filter((row) => row.success).length
      return `${successes}/${subset.length} (${percent(successes / subset.length)})`
    })
    lines.push(`| ${backend} | ${cells.join(" | ")} |`)
  }
  lines.push("")
  lines.push("## Browser calls by tool")
  lines.push("")
  const tools = [...new Set(rows.flatMap((row) => Object.keys(row.browserTools)))].sort()
  lines.push(`| backend | ${tools.join(" | ")} |`)
  lines.push(`|---|${tools.map(() => "---").join("|")}|`)
  for (const backend of backends) {
    const subset = rows.filter((row) => row.backend === backend)
    lines.push(
      `| ${backend} | ${tools.map((tool) => subset.reduce((sum, row) => sum + (row.browserTools[tool] ?? 0), 0)).join(" | ")} |`,
    )
  }
  lines.push("")
  lines.push("## Tool errors the model saw")
  lines.push("")
  lines.push("| backend | error | count | example |")
  lines.push("|---|---|---|---|")
  for (const backend of backends) {
    const errors = rows.filter((row) => row.backend === backend).flatMap((row) => row.toolErrors)
    if (errors.length === 0) lines.push(`| ${backend} | none | 0 | |`)
    for (const [name, count] of countBy(errors, (error) => error.name)) {
      const example = errors.find((error) => error.name === name)
      lines.push(`| ${backend} | ${name} | ${count} | ${example ? `${example.tool}: ${oneLine(example.text, 160)}` : ""} |`)
    }
  }
  lines.push("")
  lines.push("## Per task")
  lines.push("")
  lines.push(`| task | ${backends.map((backend) => `${backend} success | ${backend} turns | ${backend} wall`).join(" | ")} |`)
  lines.push(`|---|${backends.map(() => "---|---|---").join("|")}|`)
  for (const task of [...new Set(rows.map((row) => row.task))]) {
    const cells = backends.map((backend) => {
      const subset = rows.filter((row) => row.backend === backend && row.task === task)
      if (subset.length === 0) return "– | – | –"
      return (
        `${subset.filter((row) => row.success).length}/${subset.length} | ${mean(subset.map((row) => row.turns)).toFixed(1)} | ` +
        `${(mean(subset.map((row) => row.wallMs)) / 1000).toFixed(1)}s`
      )
    })
    lines.push(`| ${task} | ${cells.join(" | ")} |`)
  }
  lines.push("")
  lines.push("## Failed and slow runs")
  lines.push("")
  lines.push("Slow: wall time above twice the backend's median.")
  lines.push("")
  lines.push("| backend | task | run | result | wall | load | turns | browser calls | tool errors | answer / error | log |")
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|")
  for (const backend of backends) {
    const subset = rows.filter((row) => row.backend === backend)
    const limit = 2 * median(subset.map((row) => row.wallMs))
    for (const row of subset.filter((item) => !item.success || item.wallMs > limit)) {
      const errors = row.toolErrors.map((error) => `${error.tool}/${error.name}: ${oneLine(error.text, 120)}`).join("; ")
      lines.push(
        `| ${backend} | ${row.task} | ${row.run} | ${row.success ? "slow" : "FAIL"} | ${(row.wallMs / 1000).toFixed(1)}s | ` +
          `${row.load.toFixed(1)} | ${row.turns} | ${row.browserCalls} | ${oneLine(errors, 400) || "–"} | ` +
          `${oneLine(row.error ? `${row.error} / answer: ${row.answer}` : `answer: ${row.answer}`, 240)} | ${row.log} |`,
      )
    }
  }
  lines.push("")
  return lines.join("\n")
}

if (import.meta.main) {
  const file = process.argv[2]
  if (!file) throw new Error("usage: bun script/browser-bench/report.ts <runs.jsonl>")
  const text = await Bun.file(file).text()
  const rows = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Row)
  console.log(renderSummary(rows))
}
