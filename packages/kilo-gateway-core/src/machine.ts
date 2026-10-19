export * as KiloMachine from "./machine.js"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"

// Resolves or creates a stable anonymous machine ID like v1 (`packages/kilo-telemetry/src/identity.ts`):
// `KILO_MACHINE_ID` env override > `<dataDir>/telemetry-id` file > generated UUID written to `<dataDir>/telemetry-id`.
export function get(
  dataDir?: string,
  env: Record<string, string | undefined> = process.env,
): Effect.Effect<string | undefined> {
  return Effect.promise(async () => {
    const fromEnv = env.KILO_MACHINE_ID?.trim()
    if (fromEnv) return fromEnv
    if (!dataDir) return undefined
    const filePath = path.join(dataDir, "telemetry-id")
    const existing = await readFile(filePath, "utf8")
      .then((value) => value.trim())
      .catch(() => "")
    if (existing) return existing
    const created = randomUUID()
    await mkdir(dataDir, { recursive: true }).catch(() => undefined)
    await writeFile(filePath, created, "utf8").catch(() => undefined)
    return created
  })
}
