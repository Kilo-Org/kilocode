import { expect, test } from "bun:test"
import { $ } from "bun"
import path from "node:path"
import { AutocompleteTelemetryEvent } from "../src/services/autocomplete/classic-auto-complete/AutocompleteTelemetry"
import { TelemetryEventName } from "../src/services/telemetry/types"

// The extension's event catalog is the v1 catalog: same names, same values, same order. The v1 source is read from
// the pinned v1 target (`pins.v1Target` in migration-tracking/progress/features.json), so a re-pin that changes the
// v1 catalog fails here until the v2 catalog follows.
const root = path.resolve(import.meta.dir, "../../..")
const file = "packages/kilo-vscode/src/services/telemetry/types.ts"

async function v1Source() {
  const features = (await Bun.file(path.join(root, "migration-tracking/progress/features.json")).json()) as {
    pins: { v1Target: string }
  }
  const pin = features.pins.v1Target
  // A shallow CI checkout has no v1 history: fetch the pinned commit without blobs, then read the one file.
  const present = async () => (await $`git cat-file -e ${pin}^{commit}`.cwd(root).quiet().nothrow()).exitCode === 0
  // Another test process can hold the git locks while it fetches the same commit; it then exists afterwards.
  if (!(await present())) await $`git fetch --no-tags --depth=1 --filter=blob:none origin ${pin}`.cwd(root).quiet().nothrow()
  for (let attempt = 0; attempt < 50 && !(await present()); attempt++) await Bun.sleep(200)
  if (!(await present())) throw new Error(`the v1 pin ${pin} is not in this checkout and could not be fetched from origin`)
  return $`git show ${`${pin}:${file}`}`.cwd(root).quiet().text()
}

function entries(source: string, name: string) {
  const body = new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1]
  if (!body) throw new Error(`no enum ${name} in the v1 source`)
  const parsed = [...body.matchAll(/^\s*([A-Z0-9_]+) = "([^"]*)",?$/gm)].map((match) => [match[1], match[2]])
  // A member the pattern cannot read (a trailing comment, another spacing) must fail the test, not drop out of it.
  expect(parsed).toHaveLength(body.split("\n").filter((line) => line.includes(" = ")).length)
  return parsed
}

test("the extension event catalog is the v1 catalog", async () => {
  const v1 = entries(await v1Source(), "TelemetryEventName")
  expect(v1.length).toBeGreaterThan(50)
  expect(Object.entries(TelemetryEventName).map(([key, value]) => [key, value as string])).toEqual(v1)
}, 60_000)

test("the autocomplete events are entries of the one catalog", () => {
  Object.entries(AutocompleteTelemetryEvent).forEach(([key, value]) =>
    expect(TelemetryEventName[key as keyof typeof TelemetryEventName]).toBe(value),
  )
})
