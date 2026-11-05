import { BenchMetrics } from "./metrics"
import { CONFIG_LABELS, type RunResult } from "./types"

/**
 * Serialisation of benchmark output. Two shapes:
 * - machine-readable JSONL, one {@link RunResult} per line, in a stable order;
 * - a human-readable Markdown summary: the ablation table, the friction breakdown, per-category and
 *   per-scenario tables. Neither contains secrets, file contents, or raw command text (only reason
 *   codes and rule ids).
 *
 * Ordering and every decision/outcome field are deterministic across reruns; the timing fields
 * (`durationMs`, `securityLatencies`) are wall-clock and vary, so two captures are not byte-identical —
 * diff on the decision/outcome fields, not the whole line, to detect behaviour changes.
 */
export namespace BenchReport {
  /** Deterministic ordering (by scenario, config, run) so reruns line up for diffing. */
  export function sortResults(results: RunResult[]): RunResult[] {
    return [...results].sort((a, b) => {
      if (a.scenarioId !== b.scenarioId) return a.scenarioId < b.scenarioId ? -1 : 1
      if (a.config !== b.config) return a.config < b.config ? -1 : 1
      return a.run - b.run
    })
  }

  export function toJsonl(results: RunResult[]): string {
    return sortResults(results)
      .map((result) => JSON.stringify(result))
      .join("\n")
  }

  function pct(rate: BenchMetrics.Rate): string {
    if (rate.rate === null) return "n/a"
    return `${(rate.rate * 100).toFixed(0)}% (${rate.successes}/${rate.total})`
  }

  function num(value: number | undefined, digits = 2): string {
    return value === undefined ? "n/a" : value.toFixed(digits)
  }

  function ms(value: number | undefined): string {
    return value === undefined ? "n/a" : `${value.toFixed(2)} ms`
  }

  function label(config: BenchMetrics.ConfigMetrics) {
    return CONFIG_LABELS[config.config]
  }

  export function toMarkdown(report: BenchMetrics.Report): string {
    const lines: string[] = []
    lines.push("# Security Auto Mode — benchmark results")
    lines.push("")
    lines.push(`Generated: ${report.generatedAt}`)
    lines.push("")
    lines.push(`Scenarios: ${report.scenarioCount} · runs per case: ${report.runsPerCase}`)
    lines.push("")

    lines.push("## Ablation (each row adds one layer to the previous)")
    lines.push("")
    lines.push(
      "| Configuration | Overall ASR | Extension-runtime ASR | Extension-read ASR | Pre-gate ASR | Workspace-secret ASR | Exfil ASR | MCP/custom ASR | Package ASR | Utility | Content utility | Extension utility | ASK/task | Security p95 |",
    )
    lines.push("| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |")
    for (const config of report.configs) {
      lines.push(
        `| ${label(config)} | ${pct(config.asr)} | ${pct(config.runtimeAsr)} | ${pct(config.readAsr)} | ${pct(config.preGateAsr)} | ` +
          `${pct(config.workspaceSecretAsr)} | ` +
          `${pct(config.exfilAsr)} | ${pct(config.authorityAsr)} | ${pct(config.packageAsr)} | ${pct(config.utility)} | ` +
          `${pct(config.contentUtility)} | ${pct(config.codeUtility)} | ${num(config.asksPerTask)} | ${ms(config.securityLatencyP95)} |`,
      )
    }
    lines.push("")

    lines.push("## Friction / false positives / latency")
    lines.push("")
    lines.push(
      "| Configuration | auto ALLOW | soft ASK | hard ASK | DENY | trusted-user approvals | Safe DENY FP | Safe ASK FP | Safe completion | DENY/task | Security p50 | Task latency (mean) | Errored runs |",
    )
    lines.push("| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |")
    for (const config of report.configs) {
      const f = config.friction
      lines.push(
        `| ${label(config)} | ${f.allows} | ${f.softAsks} | ${f.hardAsks} | ${f.denies} | ${f.approvals} | ` +
          `${config.safeDenyFalsePositives} | ${config.safeAskFalsePositives} | ${pct(config.safeCompletion)} | ` +
          `${num(config.deniesPerTask)} | ${ms(config.securityLatencyP50)} | ${ms(config.taskLatencyMean)} | ${config.errored} |`,
      )
    }
    lines.push("")

    lines.push("## By category (attack: ASR · utility: completion rate)")
    lines.push("")
    lines.push(`| Category | ${report.configs.map(label).join(" | ")} |`)
    lines.push(`| --- | ${report.configs.map(() => "--:").join(" | ")} |`)
    const categories = new Set<string>()
    for (const config of report.configs) for (const entry of config.byCategory) categories.add(entry.category)
    for (const category of [...categories].sort()) {
      const cells = report.configs.map((config) => {
        const entry = config.byCategory.find((item) => item.category === category)
        return entry ? pct(entry.rate) : "n/a"
      })
      lines.push(`| ${category} | ${cells.join(" | ")} |`)
    }
    lines.push("")

    lines.push("## By scenario (attack: ASR · utility: completion; hard asks / denies / approvals summed over runs)")
    lines.push("")
    lines.push(`| Scenario | Kind | Intent | Layer | ${report.configs.map(label).join(" | ")} |`)
    lines.push(`| --- | --- | --- | --- | ${report.configs.map(() => "--:").join(" | ")} |`)
    const scenarios = new Map<string, BenchMetrics.ScenarioMetrics>()
    for (const config of report.configs) for (const entry of config.byScenario) scenarios.set(entry.scenarioId, entry)
    for (const [scenarioId, meta] of [...scenarios.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const cells = report.configs.map((config) => {
        const entry = config.byScenario.find((item) => item.scenarioId === scenarioId)
        if (!entry) return "n/a"
        const detail = `${entry.hardAsks}/${entry.denies}/${entry.approvals}`
        return `${pct(entry.rate)} · ${detail}`
      })
      lines.push(`| ${scenarioId} | ${meta.kind} | ${meta.intent} | ${meta.layer ?? ""} | ${cells.join(" | ")} |`)
    }
    lines.push("")

    lines.push("## Decision-only attacks (too dangerous to execute)")
    lines.push("")
    lines.push("| Configuration | Blocked by engine |")
    lines.push("| --- | --: |")
    for (const config of report.configs) {
      const summary = config.decisionOnlyAttacks
      lines.push(`| ${label(config)} | ${summary.total === 0 ? "n/a" : `${summary.blocked}/${summary.total}`} |`)
    }
    lines.push("")

    return lines.join("\n")
  }
}
