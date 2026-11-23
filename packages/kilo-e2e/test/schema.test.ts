import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { SCHEMA_DOCUMENTS, SCHEMA_VERSION, jsonSchema, type Lane, type ScenarioID } from "../src/schema"
import {
  ALL_MANIFESTS,
  LANES,
  SCENARIO_IDS,
  assertSelectorFree,
  manifest,
  supportsLane,
  validateManifest,
} from "../src/scenarios"
import { root } from "./helpers"

// The lanes each scenario must declare, written out rather than derived from the generator, so a
// scenario that wrongly loses a lane fails here instead of shrinking the matrix silently.
const EXPECTED_LANES: Record<ScenarioID, Lane[]> = {
  "session.open": ["local", "cloud"],
  "prompt.stream": ["local", "cloud"],
  "permission.continue": ["local", "cloud"],
  "settings.telemetry": ["local", "cloud"],
  "followup.new-session": ["local"],
}

describe("scenario manifests", () => {
  test("defines every stable scenario on the lanes that support it", () => {
    expect(SCENARIO_IDS).toEqual([
      "session.open",
      "prompt.stream",
      "permission.continue",
      "settings.telemetry",
      "followup.new-session",
    ])
    expect(LANES).toEqual(["local", "cloud"])
    expect(Object.keys(EXPECTED_LANES).sort()).toEqual([...SCENARIO_IDS].sort())
    // Every scenario keeps at least one lane, every generated cell is a supported pair, no cell is
    // generated twice, and the generated matrix is exactly the declared one — so a scenario cannot
    // silently lose a lane, and an unsupported pair can never be generated.
    const cells = ALL_MANIFESTS.map((entry) => `${entry.id}:${entry.lane}`)
    expect(new Set(cells).size).toBe(ALL_MANIFESTS.length)
    for (const id of SCENARIO_IDS) {
      const lanes = ALL_MANIFESTS.filter((entry) => entry.id === id).map((entry) => entry.lane)
      expect(lanes.length).toBeGreaterThan(0)
    }
    const declared = SCENARIO_IDS.flatMap((id) => EXPECTED_LANES[id].map((lane) => `${id}:${lane}`))
    expect(cells.sort()).toEqual(declared.sort())
    for (const entry of ALL_MANIFESTS) expect(validateManifest(entry)).toEqual(entry)
  })

  test("generates both lanes for a scenario that declares no lanes", () => {
    expect(manifest("session.open", "cloud")).toMatchObject({ id: "session.open", lane: "cloud" })
    expect(ALL_MANIFESTS.filter((entry) => entry.id === "session.open").map((entry) => entry.lane)).toEqual([
      "local",
      "cloud",
    ])
  })

  test("only the local lane supports the follow-up scenario", () => {
    expect(supportsLane("followup.new-session", "local")).toBe(true)
    expect(supportsLane("followup.new-session", "cloud")).toBe(false)
    expect(manifest("followup.new-session", "local")).toMatchObject({ id: "followup.new-session", lane: "local" })
    expect(() => manifest("followup.new-session", "cloud")).toThrow(/followup\.new-session does not run on the cloud lane; it runs on: local/)
    expect(ALL_MANIFESTS.filter((entry) => entry.id === "followup.new-session").map((entry) => entry.lane)).toEqual([
      "local",
    ])
  })

  test("keeps manifests semantic and free of IDE selectors", () => {
    for (const entry of ALL_MANIFESTS) assertSelectorFree(entry)
    expect(() => assertSelectorFree({ selector: "#submit" })).toThrow()
    expect(() => assertSelectorFree({ expected: { ui: ["#submit"] } })).toThrow()
    expect(() => assertSelectorFree({ expected: { ui: ["//button"] } })).toThrow()
  })

  test("rejects malformed manifests", () => {
    expect(() => validateManifest({ schemaVersion: 1 })).toThrow()
    expect(() => validateManifest({ ...ALL_MANIFESTS[0], schemaVersion: 2 })).toThrow()
  })
})

describe("generated schemas", () => {
  test("committed JSON Schema documents are current", async () => {
    for (const name of Object.keys(SCHEMA_DOCUMENTS)) {
      const file = join(root, "schema", `${name}.v${SCHEMA_VERSION}.json`)
      const expected = `${JSON.stringify(jsonSchema(name as keyof typeof SCHEMA_DOCUMENTS), null, 2)}\n`
      expect(await Bun.file(file).text()).toBe(expected)
    }
  })

  test("documents target draft 2020-12", () => {
    for (const name of Object.keys(SCHEMA_DOCUMENTS)) {
      const document = jsonSchema(name as keyof typeof SCHEMA_DOCUMENTS)
      expect(document.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    }
  })
})
