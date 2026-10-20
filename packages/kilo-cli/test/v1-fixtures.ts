// v1 reference fixtures (U-E0-05): v1 session-policy behavior recorded by running the v1 code at the pinned v1
// target. script/v1-fixtures.ts regenerates them. Each fixture is one area for one E2 unit; each case is one call of
// a v1 function (`fn`) with its `input` and the `output` v1 gave. A v2 test asserts its own behavior against them.
import path from "node:path"
import { Schema } from "effect"

export const areas = {
  "offline-wait": "U-E2-01",
  overflow: "U-E2-02",
  "slow-snapshot": "U-E2-03",
  snapshot: "U-E2-04",
} as const

export type Area = keyof typeof areas

const Case = Schema.Struct({
  name: Schema.String,
  fn: Schema.String,
  input: Schema.Unknown,
  output: Schema.Unknown,
})

const Fixture = Schema.Struct({
  unit: Schema.String,
  area: Schema.String,
  v1: Schema.Struct({ commit: Schema.String, sources: Schema.Array(Schema.String) }),
  constants: Schema.Record(Schema.String, Schema.Unknown),
  cases: Schema.Array(Case),
})

export type V1Fixture = typeof Fixture.Type

export async function load(area: Area) {
  return Schema.decodeUnknownSync(Fixture)(
    await Bun.file(path.join(import.meta.dir, "fixtures", "v1", `${area}.json`)).json(),
  )
}

/** The case with this name. Fails when the fixture has no such case, so a renamed case cannot pass silently. */
export function pick(fixture: V1Fixture, name: string) {
  const found = fixture.cases.find((c) => c.name === name)
  if (!found) throw new Error(`${fixture.area}: no v1 case named ${name}`)
  return found
}
