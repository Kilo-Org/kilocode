// kilocode_change - new file. Guards the exerciser's scenario sharding, which the CI matrix
// relies on for route coverage: if a shard split ever dropped or duplicated a scenario, every
// shard would still exit 0 and the route would silently stop being exercised.
import { describe, expect, test } from "bun:test"
import { http } from "../../server/httpapi-exercise/dsl"
import { parseOptions, selectedScenarios } from "../../server/httpapi-exercise/routing"
import type { Scenario } from "../../server/httpapi-exercise/types"

// `parseOptions` falls back to KILO_HTTPAPI_SHARD, which CI sets. Clear it so these
// assertions describe the arguments under test rather than the ambient environment.
delete process.env.KILO_HTTPAPI_SHARD

function options(...args: string[]) {
  return parseOptions(["--mode", "effect", ...args])
}

function scenario(name: string, path = `/${name}`) {
  return http.protected.get(path, name).json()
}

function key(item: Scenario) {
  return `${item.method} ${item.path} ${item.name}`
}

const heavy = http.protected.post("/heap", "heap").degradesProcess().json()

describe("httpapi exerciser sharding", () => {
  const scenarios: Scenario[] = Array.from({ length: 40 }, (_, index) => scenario(`route-${index}`))

  test("every shard count covers the full selection exactly once", () => {
    for (const total of [1, 2, 3, 4, 5, 6, 7, 13]) {
      const seen = Array.from({ length: total }, (_, index) =>
        selectedScenarios(options("--shard", `${index + 1}/${total}`), scenarios),
      ).flat()
      expect(seen.map(key).sort()).toEqual(scenarios.map(key).sort())
    }
  })

  test("shards are balanced to within one scenario", () => {
    const total = 6
    const sizes = Array.from(
      { length: total },
      (_, index) => selectedScenarios(options("--shard", `${index + 1}/${total}`), scenarios).length,
    )
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
  })

  test("the same shard is stable across calls", () => {
    const once = selectedScenarios(options("--shard", "2/5"), scenarios).map(key)
    const twice = selectedScenarios(options("--shard", "2/5"), scenarios).map(key)
    expect(once).toEqual(twice)
  })

  test("scenarios that share a method, path and name are not collapsed", () => {
    // 315 real scenarios share only 306 distinct triples, so the split has to keep duplicates.
    const duplicated = [scenario("dupe"), scenario("dupe"), scenario("dupe")]
    const seen = [1, 2].flatMap((index) => selectedScenarios(options("--shard", `${index}/2`), duplicated))
    expect(seen).toHaveLength(3)
  })

  test("process-degrading scenarios run last", () => {
    const mixed = [heavy, ...scenarios]
    const unsharded = selectedScenarios(options(), mixed)
    expect(unsharded).toHaveLength(mixed.length)
    expect(key(unsharded.at(-1)!)).toBe(key(heavy))

    for (let index = 1; index <= 4; index++) {
      const shard = selectedScenarios(options("--shard", `${index}/4`), mixed)
      const at = shard.findIndex((item) => key(item) === key(heavy))
      if (at !== -1) expect(at).toBe(shard.length - 1)
    }
  })

  test("shard bounds are validated", () => {
    expect(() => options("--shard", "0/4")).toThrow()
    expect(() => options("--shard", "5/4")).toThrow()
    expect(() => options("--shard", "nonsense")).toThrow()
    expect(options().shard).toBeUndefined()
  })
})
