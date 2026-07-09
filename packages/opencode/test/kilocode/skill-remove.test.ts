import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { target } from "../../src/kilocode/skill-remove"

const info = (location: string) => ({
  name: "synthetic",
  description: "Synthetic skill used for path validation.",
  location,
  content: "synthetic",
})

describe("skill removal target", () => {
  test("rejects the canonical built-in location", () => {
    expect(() => target("builtin", [info("builtin")])).toThrow("cannot remove built-in skill")
  })

  test("rejects the legacy customize-opencode built-in location", () => {
    expect(() => target("<built-in>", [info("<built-in>")])).toThrow("cannot remove built-in skill")
  })

  test("rejects locations that are not in the active skill registry", () => {
    const location = path.join(path.parse(process.cwd()).root, "__kilo_synthetic__", "SKILL.md")
    expect(() => target(location, [])).toThrow("skill not found in registry")
  })

  test("rejects relative registered locations", () => {
    const location = path.join("synthetic", "SKILL.md")
    expect(() => target(location, [info(location)])).toThrow("skill location must be absolute")
  })

  test("rejects registered locations that are not manifests", () => {
    const location = path.join(path.parse(process.cwd()).root, "__kilo_synthetic__", "skill")
    expect(() => target(location, [info(location)])).toThrow("skill location must reference SKILL.md")
  })

  test("rejects URL-backed cache entries", () => {
    const location = path.join(Global.Path.cache, "skills", "synthetic", "SKILL.md")
    expect(() => target(location, [info(location)])).toThrow("remove URL-backed skills from configuration")
  })

  test("returns only the registered skill manifest", () => {
    const location = path.join(path.parse(process.cwd()).root, "__kilo_synthetic__", "skill", "SKILL.md")
    expect(target(location, [info(location)])).toBe(location)
  })
})
