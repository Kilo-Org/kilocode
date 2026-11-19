import { join } from "node:path"
import { manifest, run, type Lane, type ScenarioID } from "../../kilo-e2e/src/index"

export const CELL_TIMEOUT_MS = 30 * 60_000
export const PROVIDER_TIMEOUT_MS = 20 * 60_000
export const DRIVER_TIMEOUT_MS = 32 * 60_000

export function cellRunId(base: string, scenario: ScenarioID, lane: Lane): string {
  return `${base}-${scenario.replaceAll(".", "-")}-${lane}`
}

/** Run one K1 cell through the merged C1 provider and JetBrains Starter/Driver adapter. */
export async function runCell(input: {
  root: string
  cloud: string
  artifactsDir: string
  runId: string
  scenario: ScenarioID
  lane: Lane
  kiloCommit: string | null
  cloudCommit?: string | null
  signal?: AbortSignal
}) {
  return run({
    manifest: { ...manifest(input.scenario, input.lane), timeoutMs: CELL_TIMEOUT_MS },
    provider: {
      id: "cloud-agent-next-fixture",
      command: [process.execPath, join(input.root, "script/e2e-cloud-provider.ts"), input.cloud],
      timeoutMs: PROVIDER_TIMEOUT_MS,
    },
    driver: {
      id: "jetbrains-starter",
      command: [process.execPath, join(input.root, "script/e2e-driver.ts")],
    },
    artifactsDir: input.artifactsDir,
    runId: input.runId,
    signal: input.signal,
    provenance: {
      kiloCommit: input.kiloCommit,
      cloudCommit: input.cloudCommit ?? null,
    },
    timeouts: { provider: PROVIDER_TIMEOUT_MS, driver: DRIVER_TIMEOUT_MS },
  })
}
