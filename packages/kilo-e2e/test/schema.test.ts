import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { SCHEMA_DOCUMENTS, SCHEMA_VERSION, jsonSchema } from "../src/schema"
import { ALL_MANIFESTS, LANES, SCENARIO_IDS, assertSelectorFree, validateManifest } from "../src/scenarios"
import { root } from "./helpers"

describe("scenario manifests", () => {
  test("defines every stable scenario for both lanes", () => {
    expect(SCENARIO_IDS).toEqual(["session.open", "prompt.stream", "permission.continue"])
    expect(LANES).toEqual(["local", "cloud"])
    expect(ALL_MANIFESTS).toHaveLength(SCENARIO_IDS.length * LANES.length)
    const cells = ALL_MANIFESTS.map((entry) => `${entry.id}:${entry.lane}`)
    expect(new Set(cells).size).toBe(ALL_MANIFESTS.length)
    for (const entry of ALL_MANIFESTS) expect(validateManifest(entry)).toEqual(entry)
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
