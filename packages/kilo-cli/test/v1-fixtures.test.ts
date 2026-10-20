import { describe, expect, test } from "bun:test"
import path from "node:path"
import { type Area, areas, load, pick } from "./v1-fixtures"

const pinned: string = (
  await Bun.file(path.join(import.meta.dir, "../../../migration-tracking/progress/features.json")).json()
).pins.v1Target

describe("v1 reference fixtures", () => {
  for (const [area, unit] of Object.entries(areas) as [Area, string][]) {
    test(`${area} parses and records the pinned v1 target`, async () => {
      const fixture = await load(area)
      expect(fixture.area).toBe(area)
      expect(fixture.unit).toBe(unit)
      expect(fixture.v1.commit).toBe(pinned)
      expect(fixture.v1.sources.length).toBeGreaterThan(0)
      expect(fixture.cases.length).toBeGreaterThan(0)
      expect(new Set(fixture.cases.map((c) => c.name)).size).toBe(fixture.cases.length)
      expect(pick(fixture, fixture.cases[0].name)).toBe(fixture.cases[0])
    })
  }

  test("pick fails on an unknown case", async () => {
    expect(() =>
      pick({ unit: "U-E2-00", area: "none", v1: { commit: pinned, sources: [] }, constants: {}, cases: [] }, "missing"),
    ).toThrow("no v1 case named missing")
  })
})
