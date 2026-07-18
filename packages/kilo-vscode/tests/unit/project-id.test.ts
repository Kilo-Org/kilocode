import { describe, expect, test } from "bun:test"
import { projectIdFor } from "../../src/agent-manager/project-id"

describe("projectIdFor", () => {
  test("returns the same id for the same input on repeated calls", () => {
    const input = "/Users/example/repo"
    expect(projectIdFor(input)).toBe(projectIdFor(input))
  })

  test("returns a 16-character lowercase hex string", () => {
    const id = projectIdFor("/Users/example/repo")
    expect(id).toHaveLength(16)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  test("returns different ids for different inputs", () => {
    const a = projectIdFor("/Users/example/repo-a")
    const b = projectIdFor("/Users/example/repo-b")
    expect(a).not.toBe(b)
  })

  test("is case-sensitive: upper- and lower-case paths produce different ids", () => {
    expect(projectIdFor("/Users/example/Repo")).not.toBe(projectIdFor("/Users/example/repo"))
  })

  test("treats trailing slashes as distinct from the bare path", () => {
    expect(projectIdFor("/Users/example/repo")).not.toBe(projectIdFor("/Users/example/repo/"))
  })

  test("documents the case-sensitivity contract: paths differing only in case produce different ids", () => {
    const upper = projectIdFor("/Users/example/Repo")
    const lower = projectIdFor("/Users/example/repo")
    expect(upper).not.toBe(lower)
    expect(projectIdFor("/Users/example/Repo")).toBe(upper)
  })
})
