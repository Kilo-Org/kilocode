import { join, resolve } from "node:path"
import { ALL_MANIFESTS, LANES, SCENARIO_IDS, manifest } from "./scenarios"
import { run, RunError } from "./coordinator"
import type { Lane, ScenarioID } from "./schema"

const root = resolve(import.meta.dir, "..")
const fixtures = join(root, "fixtures")

type Demo = {
  command: string
  all: boolean
  scenario: ScenarioID
  lane: Lane
  artifacts: string
  runId?: string
}

function usage(message: string): never {
  throw new RunError("config", message)
}

function parse(argv: string[]): Demo {
  const [command, ...rest] = argv
  if (command !== "demo") usage("usage: cli.ts demo [--all] [--scenario <id>] [--lane <local|cloud>]")
  const parsed: Demo = {
    command,
    all: false,
    scenario: "session.open",
    lane: "local",
    artifacts: join(root, ".artifacts"),
  }
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (flag === "--all") parsed.all = true
    else if (flag === "--scenario") {
      if (!value || !SCENARIO_IDS.includes(value as ScenarioID)) usage(`unknown scenario: ${value ?? ""}`)
      parsed.scenario = value as ScenarioID
      index += 1
    } else if (flag === "--lane") {
      if (!value || !LANES.includes(value as Lane)) usage(`unknown lane: ${value ?? ""}`)
      parsed.lane = value as Lane
      index += 1
    } else if (flag === "--artifacts") {
      if (!value) usage("--artifacts requires a value")
      parsed.artifacts = resolve(value)
      index += 1
    } else if (flag === "--run-id") {
      if (!value) usage("--run-id requires a value")
      parsed.runId = value
      index += 1
    } else usage(`unknown flag: ${flag}`)
  }
  return parsed
}

async function commit(): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
    windowsHide: true,
  })
  const code = await proc.exited
  if (code !== 0) return null
  const value = (await new Response(proc.stdout).text()).trim()
  return value.length === 0 ? null : value
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let options: Demo
  try {
    options = parse(argv)
  } catch (caught) {
    if (!(caught instanceof RunError)) throw caught
    console.error(caught.message)
    return 2
  }
  const kiloCommit = await commit()
  const base = options.runId ?? `demo-${Date.now()}`
  const cells = options.all ? ALL_MANIFESTS : [manifest(options.scenario, options.lane)]
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once("SIGINT", stop)

  const results: object[] = []
  let failed = false
  try {
    for (const cell of cells) {
      try {
        const evidence = await run({
          manifest: cell,
          provider: { id: "fake-provider", command: [process.execPath, join(fixtures, "provider.ts")] },
          driver: { id: "fake-driver", command: [process.execPath, join(fixtures, "driver.ts")] },
          artifactsDir: options.artifacts,
          runId: `${base}-${cell.id}-${cell.lane}`,
          signal: controller.signal,
          provenance: { kiloCommit },
        })
        results.push({
          runId: evidence.runId,
          scenarioId: evidence.scenarioId,
          lane: evidence.lane,
          outcome: evidence.outcome,
          evidence: join(options.artifacts, evidence.runId, "evidence.json"),
        })
        if (evidence.outcome !== "passed") failed = true
      } catch (caught) {
        if (!(caught instanceof RunError)) throw caught
        failed = true
        results.push({
          scenarioId: cell.id,
          lane: cell.lane,
          outcome: caught.code,
          evidence: caught.evidencePath ?? null,
        })
      }
    }
  } finally {
    process.removeListener("SIGINT", stop)
  }

  console.log(JSON.stringify({ artifactsDir: options.artifacts, cells: results }, null, 2))
  return failed ? 1 : 0
}

if (import.meta.main) process.exitCode = await main()
