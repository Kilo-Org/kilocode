import { Duration } from "effect"
import { TestShard } from "../../../script/kilocode/test-shard" // kilocode_change - reuse the unit runner's LPT splitter
import { OpenApiMethods, type OpenApiSpec, type Options, type Result, type Scenario } from "./types"

type ScenarioTimeout = `${number} ${Duration.Unit}`

const durationUnits = new Set<string>([
  "nano",
  "nanos",
  "micro",
  "micros",
  "milli",
  "millis",
  "second",
  "seconds",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
])

export function routeKeys(spec: OpenApiSpec) {
  return Object.entries(spec.paths ?? {})
    .flatMap(([path, item]) =>
      OpenApiMethods.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

export function routeKey(scenario: Scenario) {
  return `${scenario.method} ${scenario.path}`
}

export function coverageResult(scenario: Scenario): Result {
  if (scenario.kind === "todo") return { status: "skip", scenario }
  return { status: "pass", scenario }
}

export function parseOptions(args: string[]): Options {
  const mode = option(args, "--mode") ?? "effect"
  if (mode !== "effect" && mode !== "coverage" && mode !== "auth") throw new Error(`invalid --mode ${mode}`)
  return {
    mode,
    include: option(args, "--include"),
    startAt: option(args, "--start-at"),
    stopAt: option(args, "--stop-at"),
    failOnMissing: args.includes("--fail-on-missing"),
    failOnSkip: args.includes("--fail-on-skip"),
    scenarioTimeout: parseScenarioTimeout(option(args, "--scenario-timeout") ?? "30 seconds"),
    progress: args.includes("--progress"),
    trace: args.includes("--trace"),
    shard: parseShard(option(args, "--shard") ?? (process.env.KILO_HTTPAPI_SHARD?.trim() || undefined)), // kilocode_change
  }
}

// kilocode_change start - `--shard N/M` splits the selection across parallel processes
function parseShard(input: string | undefined) {
  const parsed = TestShard.parse(input)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}
// kilocode_change end

export function matches(options: Options, scenario: Scenario) {
  if (!options.include) return true
  return (
    scenario.name.includes(options.include) ||
    scenario.path.includes(options.include) ||
    scenario.method.includes(options.include.toUpperCase())
  )
}

export function selectedScenarios(options: Options, scenarios: Scenario[]) {
  const included = scenarios.filter((scenario) => matches(options, scenario))
  const start = options.startAt ? included.findIndex((scenario) => matchesName(options.startAt!, scenario)) : 0
  const end = options.stopAt
    ? included.findIndex((scenario) => matchesName(options.stopAt!, scenario))
    : included.length - 1
  if (start === -1) throw new Error(`--start-at matched no scenario: ${options.startAt}`)
  if (end === -1) throw new Error(`--stop-at matched no scenario: ${options.stopAt}`)
  // kilocode_change start - shard first, then push process-degrading scenarios to the back of
  // whatever shard they landed in. Both steps only reorder and partition; neither drops a
  // scenario, and the `missing`/`extra` route gates in index.ts are computed from the full list
  // either way.
  const sliced = included.slice(start, end + 1)
  return degradedLast(options.shard ? shardScenarios(sliced, options.shard) : sliced)
}
// kilocode_change end

// kilocode_change start
/**
 * LPT-split the selection into `shard.total` groups and return this process's group.
 *
 * Scenarios are weighted equally rather than by observed duration. That is deliberate: with
 * the process-degrading scenarios sorted to the back (see `degradesProcess` in dsl.ts), the
 * measured spread is narrow -- median 0.71s against a 1.99s worst case -- so count balancing
 * lands within a few percent of a duration-weighted split and needs no history plumbing.
 * Keys carry an occurrence suffix because scenario names are not unique: 315 scenarios share
 * 306 distinct `method path name` triples, so keying on the triple alone would collide and
 * silently drop the duplicates.
 */
export function shardScenarios(scenarios: Scenario[], shard: { index: number; total: number }) {
  const seen = new Map<string, number>()
  const byKey = new Map<string, Scenario>()
  const keys = scenarios.map((scenario) => {
    const base = routeKey(scenario) + " " + scenario.name
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    const key = count === 1 ? base : `${base}#${count}`
    byKey.set(key, scenario)
    return key
  })
  const group = TestShard.split(keys, () => 1, shard.total)[shard.index - 1] ?? []
  return group.map((key) => byKey.get(key)!)
}

function degradedLast(scenarios: Scenario[]) {
  const degrades = (scenario: Scenario) => scenario.kind === "active" && scenario.degradesProcess
  return [...scenarios.filter((scenario) => !degrades(scenario)), ...scenarios.filter(degrades)]
}
// kilocode_change end

function matchesName(value: string, scenario: Scenario) {
  return scenario.name.includes(value) || scenario.path.includes(value) || scenario.method.includes(value.toUpperCase())
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function parseScenarioTimeout(input: string) {
  if (!isScenarioTimeout(input)) throw new Error(`invalid --scenario-timeout ${input}`)
  return Duration.fromInputUnsafe(input)
}

function isScenarioTimeout(input: string): input is ScenarioTimeout {
  const [amount, unit, extra] = input.trim().split(/\s+/)
  return extra === undefined && amount !== undefined && Number.isFinite(Number(amount)) && durationUnits.has(unit ?? "")
}
