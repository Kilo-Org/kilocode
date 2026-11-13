import { describe, expect, test } from "bun:test"
import path from "node:path"
import { SkillRemove, type Entry } from "../src/skill/remove"

const directory = path.resolve("/project")
const home = path.resolve("/home/user")
const cache = path.join(home, ".cache", "kilo", "skills")
const entries: Entry[] = [
  { type: "directory", path: path.join(directory, ".kilo2") },
  {
    type: "document",
    info: { skills: ["./custom-skills", "https://example.com/skills", "~/shared-skills", "/opt/skills"] },
  },
]
const roots = SkillRemove.roots(entries, directory, home)
const check = (file: string, skills = [{ path: file }], skillRoots = roots, cacheRoot = cache) =>
  SkillRemove.target(file, skills, skillRoots, cacheRoot)

describe("skill removal roots", () => {
  test("reads directory and configured path roots but not URLs", () => {
    expect(roots).toEqual([
      path.join(directory, ".kilo2", "skill"),
      path.join(directory, ".kilo2", "skills"),
      path.join(directory, "custom-skills"),
      path.join(home, "shared-skills"),
      path.resolve("/opt/skills"),
    ])
  })
})

describe("skill removal target", () => {
  test("accepts a directory skill and a flat top-level skill", () => {
    const directorySkill = path.join(directory, ".kilo2", "skills", "demo", "SKILL.md")
    const flatSkill = path.join(directory, ".kilo2", "skills", "demo.md")
    expect(check(directorySkill)).toEqual({ _tag: "target", path: directorySkill })
    expect(check(flatSkill)).toEqual({ _tag: "target", path: flatSkill })
  })

  test("accepts a skill from each configured root", () => {
    for (const root of roots) {
      const file = path.join(root, "demo", "SKILL.md")
      expect(check(file)).toEqual({ _tag: "target", path: file })
    }
  })

  test("rejects an unregistered skill", () => {
    const file = path.join(directory, ".kilo2", "skills", "demo", "SKILL.md")
    expect(check(file, [])).toEqual({ _tag: "failure", reason: "not_found" })
  })

  test("rejects a relative path even when it is registered", () => {
    const file = "skills/demo/SKILL.md"
    expect(check(file, [{ path: file }])).toEqual({ _tag: "failure", reason: "not_removable" })
  })

  test("rejects a path outside every configured root", () => {
    const file = path.join(directory, "elsewhere", "SKILL.md")
    expect(check(file)).toEqual({ _tag: "failure", reason: "not_removable" })
  })

  test("rejects traversal that resolves outside the root", () => {
    const file = path.join(directory, ".kilo2", "skills", "..", "..", "elsewhere", "SKILL.md")
    expect(check(file)).toEqual({ _tag: "failure", reason: "not_removable" })
  })

  test("rejects the root itself", () => {
    const root = path.join(directory, ".kilo2", "skills")
    expect(check(root, [{ path: root }])).toEqual({ _tag: "failure", reason: "not_removable" })
  })

  test("rejects a nested file that is not a manifest", () => {
    const file = path.join(directory, ".kilo2", "skills", "demo", "reference.md")
    expect(check(file)).toEqual({ _tag: "failure", reason: "not_removable" })
  })

  test("rejects a file that is not markdown", () => {
    const file = path.join(directory, ".kilo2", "skills", "demo.txt")
    expect(check(file)).toEqual({ _tag: "failure", reason: "not_removable" })
  })

  test("rejects built-in skills", () => {
    const file = path.resolve("/builtin/opencode.md")
    expect(check(file)).toEqual({ _tag: "failure", reason: "not_removable" })
  })

  test("rejects URL-backed cache entries even when the cache is under a configured root", () => {
    const wide = SkillRemove.roots([{ type: "document", info: { skills: ["~/"] } }], directory, home)
    const file = path.join(cache, "demo", "SKILL.md")
    expect(check(file, [{ path: file }], wide)).toEqual({ _tag: "failure", reason: "not_removable" })
  })
})

describe("skill removal targets", () => {
  test("returns only the removable registrations", () => {
    const directorySkill = path.join(directory, ".kilo2", "skills", "demo", "SKILL.md")
    const flatSkill = path.join(directory, "custom-skills", "flat.md")
    const nested = path.join(directory, ".kilo2", "skills", "demo", "reference.md")
    const builtin = path.resolve("/builtin/opencode.md")
    const cached = path.join(cache, "demo", "SKILL.md")
    expect(
      SkillRemove.targets(
        [directorySkill, flatSkill, nested, builtin, cached].map((file) => ({ path: file })),
        roots,
        cache,
      ),
    ).toEqual([directorySkill, flatSkill])
  })
})
