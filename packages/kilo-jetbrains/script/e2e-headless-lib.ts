import { resolve } from "node:path"
import {
  LANES,
  SCENARIO_IDS,
  type Lane,
  type ScenarioID,
} from "../../kilo-e2e/src/index"

export class UsageError extends Error {}

export type LaneSelection = Lane | "both"
export type StackMode = "auto" | "reuse"
export type DisplayMode = "auto" | "system" | "xvfb"

export type Options = {
  lanes: Lane[]
  scenarios: ScenarioID[]
  cloud?: string
  gitUrl?: string
  artifacts: string
  runId?: string
  stack: StackMode
  display: DisplayMode
  keepStack: boolean
  help: boolean
}

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Services the C1 fixture provider requires before it will prepare a Cloud lane. */
export const STACK_SERVICES = [
  "nextjs",
  "cloud-agent-next",
  "ai-gateway",
  "fake-llm",
  "postgres",
  "container-usage-meter",
] as const

export type StackService = { name: string; port: number; status: string }
export type StackStatus = { services: StackService[] }

export function validRunId(value: string): boolean {
  return SAFE_RUN_ID.test(value) && !value.includes("..")
}

export function parseArgs(argv: string[], defaults: { artifacts: string }): Options {
  const options: Options = {
    lanes: [...LANES],
    scenarios: ["session.open"],
    artifacts: defaults.artifacts,
    stack: "auto",
    display: "auto",
    keepStack: false,
    help: false,
  }
  let scenarioSet = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") {
      options.help = true
      continue
    }
    if (arg === "--keep-stack") {
      options.keepStack = true
      continue
    }
    const value = argv[++index]
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`missing value for ${arg}`)
    }
    switch (arg) {
      case "--lane":
        options.lanes = parseLanes(value)
        break
      case "--scenario": {
        if (!scenarioSet) {
          options.scenarios = []
          scenarioSet = true
        }
        for (const id of value.split(",").map((item) => item.trim())) {
          if (!isScenarioId(id)) {
            throw new UsageError(`unknown scenario: ${id || "(empty)"}`)
          }
          if (!options.scenarios.includes(id)) options.scenarios.push(id)
        }
        break
      }
      case "--cloud-repo":
        options.cloud = resolve(value)
        break
      case "--git-url":
        options.gitUrl = value
        break
      case "--artifacts":
        options.artifacts = resolve(value)
        break
      case "--run-id":
        if (!validRunId(value)) throw new UsageError(`invalid run id: ${value}`)
        options.runId = value
        break
      case "--stack":
        if (value !== "auto" && value !== "reuse") {
          throw new UsageError(`invalid --stack value: ${value} (expected auto or reuse)`)
        }
        options.stack = value
        break
      case "--display":
        if (value !== "auto" && value !== "system" && value !== "xvfb") {
          throw new UsageError(`invalid --display value: ${value} (expected auto, system, or xvfb)`)
        }
        options.display = value
        break
      default:
        throw new UsageError(`unknown argument: ${arg}`)
    }
  }

  if (options.scenarios.length === 0) throw new UsageError("at least one scenario is required")
  return options
}

/** Fill documented environment fallbacks only when the corresponding flag is absent. */
export function resolveEnvironment(
  options: Options,
  env: Record<string, string | undefined> = process.env,
): Options {
  return {
    ...options,
    cloud: options.cloud ?? (env.KILO_E2E_CLOUD_REPO ? resolve(env.KILO_E2E_CLOUD_REPO) : undefined),
    gitUrl: options.gitUrl ?? env.E2E_GIT_URL,
  }
}

function isScenarioId(value: string): value is ScenarioID {
  return SCENARIO_IDS.some((id) => id === value)
}

function parseLanes(value: string): Lane[] {
  if (value === "both") return [...LANES]
  if (value !== "local" && value !== "cloud") throw new UsageError(`unknown lane: ${value}`)
  return [value]
}

export function usage(defaults: { artifacts: string }): string {
  return `Run the JetBrains K1 matrix headlessly.

Usage:
  bun script/e2e-headless.ts [options]

Options:
  --lane <both|local|cloud>        Lanes to run (default: both)
  --scenario <id[,id]>             Scenario IDs, repeatable (default: session.open)
  --cloud-repo <path>               Kilo-Org/cloud checkout (or KILO_E2E_CLOUD_REPO)
  --git-url <url>                  Clonable Cloud lane git URL (or E2E_GIT_URL)
  --artifacts <path>               Artifact parent directory (default: ${defaults.artifacts})
  --run-id <id>                    Reuse a specific run directory name
  --stack <auto|reuse>             Start a missing Cloud stack, or require a running one
  --display <auto|system|xvfb>     Linux display strategy (default: xvfb when auto)
  --keep-stack                     Do not stop a Cloud stack this run started
  -h, --help                       Print this help

Examples:
  # cloud-agent macOS environment (virtual display is already available)
  KILO_E2E_CLOUD_REPO=~/work/cloud bun script/e2e-headless.ts --lane both

  # Linux under an owned Xvfb display
  bun script/e2e-headless.ts --lane both --cloud-repo ~/work/cloud

  # Require an already-running local Cloud stack (C1 prepares both lanes)
  bun script/e2e-headless.ts --lane local --scenario session.open --cloud-repo ~/work/cloud --stack reuse

Evidence:
  <artifacts>/<run-id>/summary.md
  <artifacts>/<run-id>/<run-id>-<scenario>-<lane>/evidence.json

Exit codes:
  0 passed, 1 a lane or owned cleanup failed, 2 preflight/setup failure, 130 cancelled
`
}

export function parseStackStatus(stdout: string): StackStatus | undefined {
  const lines = stdout.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines.at(index)?.trim()
    if (!line?.startsWith("{") || !line.endsWith("}")) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== "object" || !("services" in parsed)) continue
    const services = parsed.services
    if (!Array.isArray(services)) continue
    const visible = services.filter(isStackService)
    if (visible.length !== services.length) continue
    return { services: visible }
  }
  return undefined
}

function isStackService(value: unknown): value is StackService {
  return (
    !!value &&
    typeof value === "object" &&
    "name" in value &&
    typeof value.name === "string" &&
    "port" in value &&
    typeof value.port === "number" &&
    "status" in value &&
    typeof value.status === "string"
  )
}

export function downServices(status: StackStatus): string[] {
  return STACK_SERVICES.filter(
    (name) => !status.services.some((service) => service.name === name && service.status === "up"),
  )
}

export function parseJavaMajor(text: string): number | undefined {
  const match = text.match(/version "(\d+)(?:\.(\d+))?/)
  if (!match) return undefined
  const first = Number(match[1])
  return first === 1 ? Number(match[2]) : first
}

export type CellOutcome = "passed" | "failed" | "cancelled" | "skipped"

export type CellResult = {
  scenario: ScenarioID
  lane: Lane
  runId: string
  outcome: CellOutcome
  evidence: string | null
  failure?: { code: string; message: string }
  providerLog?: string
  failed: { name: string; detail?: string }[]
  passed: number
  cleanup?: { status: "clean" | "failed"; removed: number; leftovers: number }
}

export type SummaryInput = {
  runId: string
  startedAt: string
  endedAt: string
  platform: string
  display: string
  stack: string
  cleanup: string
  kiloCommit: string | null
  cloudCommit: string | null
  cells: CellResult[]
  exitCode: number
}

/** Name of the C1 provider log for the operation that failed. */
export function providerLogName(code: string): string {
  return code === "cleanup_failed" ? "provider-cleanup.log" : "provider-prepare.log"
}

export function failureHint(code: string): string {
  switch (code) {
    case "config":
      return "Check the command flags and the dedicated run directory."
    case "provider_failed":
      return "Check the C1 provider output and confirm the local Cloud stack is running."
    case "provider_timeout":
      return "The C1 provider timed out; check Docker and the Cloud local stack."
    case "provider_result":
      return "The C1 provider did not write a valid descriptor; check .env.local and the Cloud stack logs."
    case "origin":
      return "The fixture descriptor contains a non-loopback origin; C1 only supports the local stack."
    case "project":
      return "The deterministic git fixture could not be created; check git and disk space."
    case "driver_crash":
      return "The JetBrains driver exited without a result; inspect the driver log in the lane directory."
    case "driver_timeout":
      return "The JetBrains driver timed out; inspect the IDE logs and the lane watchdog."
    case "driver_result":
      return "The JetBrains driver result did not match the scenario; inspect the lane evidence."
    case "driver_failed":
      return "Inspect the failed assertions and the lane artifacts."
    case "capability":
      return "The JetBrains driver does not implement the requested scenario capability."
    case "evidence":
      return "Evidence was rejected by schema or secret validation; inspect the sanitized evidence."
    case "cleanup_failed":
      return "Fixture cleanup did not complete; inspect the owned resource ids in the lane evidence."
    case "cancelled":
      return "The run was cancelled; owned cleanup still ran."
    default:
      return "Inspect the lane evidence and this summary."
  }
}

export function renderSummary(input: SummaryInput): string {
  const result =
    input.exitCode === 0
      ? "passed"
      : input.exitCode === 130
        ? "cancelled"
        : input.exitCode === 2
          ? "preflight/setup failed"
          : "failed"
  const lines = [
    `# JetBrains headless E2E — ${input.runId}`,
    "",
    `- Result: **${result}** (exit ${input.exitCode})`,
    `- Started: ${input.startedAt}`,
    `- Ended: ${input.endedAt}`,
    `- Platform: ${input.platform}`,
    `- Display: ${input.display}`,
    `- Cloud stack: ${input.stack}`,
    `- Cleanup: ${input.cleanup}`,
    `- Kilo commit: ${input.kiloCommit ?? "unknown"}`,
    `- Cloud commit: ${input.cloudCommit ?? "unknown"}`,
    "",
    "## Cells",
    "",
    "| Lane | Scenario | Outcome | Failed | Evidence |",
    "|---|---|---|---|---|",
    ...input.cells.map(
      (cell) =>
        `| \`${cell.lane}\` | \`${cell.scenario}\` | ${cell.outcome} | ${cell.failed.length} | ${
          cell.evidence ? `\`${cell.evidence}\`` : "—"
        } |`,
    ),
  ]

  const failed = input.cells.flatMap((cell) =>
    cell.failed.map((assertion) => ({
      cell,
      assertion,
    })),
  )
  if (failed.length > 0) {
    lines.push("", "## Failed assertions", "")
    for (const entry of failed) {
      const detail = entry.assertion.detail ? `: ${entry.assertion.detail}` : ""
      lines.push(`- \`${entry.cell.lane}\` \`${entry.cell.scenario}\` / \`${entry.assertion.name}\`${detail}`)
    }
  }

  const failures = input.cells.filter((cell) => cell.failure)
  if (failures.length > 0) {
    lines.push("", "## Failure hints", "")
    for (const cell of failures) {
      lines.push(
        `- \`${cell.lane}\` \`${cell.scenario}\` (${cell.failure?.code}): ${failureHint(cell.failure?.code ?? "")}`,
      )
    }
  }

  const providerLogs = input.cells.filter((cell) => cell.providerLog)
  if (providerLogs.length > 0) {
    lines.push(
      "",
      "## Provider output",
      "",
      "_Unsanitized local-stack output; review before sharing._",
      "",
    )
    for (const cell of providerLogs) {
      lines.push(`### \`${cell.lane}\` \`${cell.scenario}\``, "", "```text", cell.providerLog ?? "", "```")
    }
  }

  lines.push("", "## Exit code", "", `${input.exitCode}`)
  return `${lines.join("\n")}\n`
}
