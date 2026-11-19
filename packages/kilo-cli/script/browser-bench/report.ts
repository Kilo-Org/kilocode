/**
 * Aggregation and output for the browser benchmark: one JSONL row per run, and a Markdown summary per backend.
 *
 *   bun script/browser-bench/report.ts <runs.jsonl>...   re-renders one matrix, or several side by side
 */

export type ToolError = { tool: string; name: string; text: string }

/**
 * Model-facing failure texts mapped to a name: the bridge error they stand for (SPEC error names), else the recurring
 * tool-level failure. The first match wins, so the specific texts come before the generic permission words.
 */
const ERROR_NAMES: [RegExp, string][] = [
  [
    /\b(browser_unavailable|tab_busy|tab_taken|user_stopped|unsupported_in_browser|needs_permission|origin_changed|protocol_mismatch)\b/,
    "$1",
  ],
  [/browser is not available right now/i, "browser_unavailable"],
  [/tab is busy/i, "tab_busy"],
  [/took over the tab/i, "tab_taken"],
  [/user stopped this browser session/i, "user_stopped"],
  [/unsupported in this browser/i, "unsupported_in_browser"],
  [/page changed (before the step ran|while permission was requested)/i, "origin_changed"],
  [/step needs permission|asked for permission the CLI cannot describe/i, "needs_permission"],
  [/out of date for this version of Kilo/i, "protocol_mismatch"],
  [/browser refused this page|\(blocked\)/i, "blocked"],
  [/stale or unknown|Unknown element reference|Ref \S+ not found/i, "stale_ref"],
  [/could not compile the snippet|Content Security Policy/i, "eval_refused_by_csp"],
  [/Local agent request failed/i, "extension_internal_error"],
  [/No tool named/i, "unknown_tool"],
  [/No dialog is currently open/i, "no_dialog"],
  [/\b(TypeError|ReferenceError|SyntaxError)\b/, "page_script_error"],
  [/declined this tool call|Permission denied|rejected/i, "permission_rejected"],
]

export function errorName(text: string) {
  for (const [pattern, name] of ERROR_NAMES) {
    const match = pattern.exec(text)
    if (match) return name === "$1" ? (match[1] ?? "other") : name
  }
  return "other"
}

export type Row = {
  backend: string
  model: string
  observation: string
  /** The tool surface the model saw: browser_* tools directly, or Code Mode's `execute`. */
  surface: string
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
  /** Code Mode `execute` calls; browser calls made inside them are counted in browserCalls when the events show them. */
  executeCalls: number
  /** Browser tool calls by tool name. */
  browserTools: Record<string, number>
  /** Every failed tool call the model saw, classified by the bridge error it maps to. */
  toolErrors: ToolError[]
  /** UTF-8 bytes of the text every browser tool result handed to the model, failures included. */
  resultBytes: number
  /** Result bytes by browser tool; an `execute` result counts for its tool when it made exactly one browser call. */
  resultBytesByTool: Record<string, { calls: number; bytes: number }>
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
      `tool surface ${[...new Set(rows.map((row) => row.surface))].join(", ")} · ` +
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
    "| backend | runs | success | mean tokens | mean non-cached | mean reasoning | mean turns | mean wall | median wall | mean CLI cost | mean list cost | total list cost | mean execute calls | mean browser calls | mean tool errors | mean result KB | mean load |",
  )
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
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
        `${mean(subset.map((row) => row.executeCalls)).toFixed(1)} | ` +
        `${mean(subset.map((row) => row.browserCalls)).toFixed(1)} | ${mean(subset.map((row) => row.toolErrors.length)).toFixed(2)} | ` +
        `${(mean(subset.map((row) => row.resultBytes)) / 1024).toFixed(1)} | ${mean(subset.map((row) => row.load)).toFixed(1)} |`,
    )
  }
  const tabs = rows.filter((row) => row.tabsAfter >= 0).map((row) => row.tabsAfter)
  if (tabs.length > 0) {
    lines.push("")
    lines.push(
      `Extension browser tabs after each extension run: first ${tabs[0]}, last ${tabs.at(-1)}, over ${tabs.length} runs ` +
        `(one session per run; a count that grows by one per run means sessions leave their tab open).`,
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
  lines.push("## Model-visible result bytes by tool")
  lines.push("")
  lines.push("Mean UTF-8 bytes per result (calls in brackets).")
  lines.push("")
  const owners = [...new Set(rows.flatMap((row) => Object.keys(row.resultBytesByTool ?? {})))].sort()
  lines.push(`| backend | ${owners.join(" | ")} |`)
  lines.push(`|---|${owners.map(() => "---").join("|")}|`)
  for (const backend of backends) {
    const subset = rows.filter((row) => row.backend === backend)
    const cells = owners.map((owner) => {
      const calls = subset.reduce((sum, row) => sum + (row.resultBytesByTool?.[owner]?.calls ?? 0), 0)
      const total = subset.reduce((sum, row) => sum + (row.resultBytesByTool?.[owner]?.bytes ?? 0), 0)
      return calls === 0 ? "–" : `${Math.round(total / calls)} (${calls})`
    })
    lines.push(`| ${backend} | ${cells.join(" | ")} |`)
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
  const files = process.argv.slice(2)
  if (files.length === 0) throw new Error("usage: bun script/browser-bench/report.ts <runs.jsonl>...")
  const texts = await Promise.all(files.map((file) => Bun.file(file).text()))
  const rows = texts
    .flatMap((text) => text.split("\n"))
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Row)
    // Recorded rows keep the error text, so a refined classification applies to an old matrix too. Rows recorded
    // before the surface fields existed came from the direct-tool surface.
    .map((row) => ({
      ...row,
      surface: row.surface ?? "direct",
      executeCalls: row.executeCalls ?? 0,
      resultBytesByTool: row.resultBytesByTool ?? {},
      toolErrors: row.toolErrors.map((error) => ({ ...error, name: errorName(error.text) })),
    }))
  // Several matrices side by side: each backend and tool surface is its own column of the tables.
  const surfaces = new Set(rows.map((row) => row.surface))
  console.log(
    renderSummary(surfaces.size > 1 ? rows.map((row) => ({ ...row, backend: `${row.backend} · ${row.surface}` })) : rows),
  )
}
