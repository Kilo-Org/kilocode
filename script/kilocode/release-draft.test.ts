import { expect, test } from "bun:test"
import { decide, next } from "./release-draft"

const tags = ["v7.8.40", "v7.8.41", "v7.10.2", "v7.9.9", "jetbrains/v1.2.3", "v7.10.3-rc.1", "vnext"]
const base = { requested: "", bump: "patch", prerelease: false, tags }
const refusal = (input: Parameters<typeof decide>[0]) => {
  try {
    decide(input)
    return ""
  } catch (err) {
    return String(err)
  }
}

test("next bumps the highest plain vx.y.z tag, compared as numbers", () => {
  expect(next(tags, "patch")).toBe("7.10.3")
  expect(next(tags, "")).toBe("7.10.3")
  expect(next(tags, "minor")).toBe("7.11.0")
  expect(next(tags, "major")).toBe("8.0.0")
  expect(() => next(tags, "huge")).toThrow("Unknown bump")
  expect(() => next(["jetbrains/v1.2.3"], "patch")).toThrow("No vx.y.z tag")
})

test("decide accepts the expected bump or the requested version", () => {
  expect(decide({ ...base, proposed: "7.10.3" })).toBe("7.10.3")
  expect(decide({ ...base, proposed: "7.11.0", bump: "minor" })).toBe("7.11.0")
  expect(decide({ ...base, proposed: "7.10.3", prerelease: true })).toBe("7.10.3")
  expect(decide({ ...base, proposed: "7.12.0-rc.2", requested: "7.12.0-rc.2", prerelease: true })).toBe("7.12.0-rc.2")
  expect(decide({ ...base, proposed: "6.0.0", requested: "6.0.0" })).toBe("6.0.0")
})

test("decide refuses a proposal that is not the expected version", () => {
  expect(refusal({ ...base, proposed: "7.10.4" })).toContain("is not the patch bump of the highest tag (7.10.3)")
  expect(refusal({ ...base, proposed: "7.10.3", bump: "minor" })).toContain("minor bump")
  expect(refusal({ ...base, proposed: "7.10.3", requested: "7.10.4" })).toContain("is not the requested version")
  expect(refusal({ ...base, proposed: "7.12.0-rc.2", requested: "7.12.0-rc.2" })).toContain("pre_release is false")
  for (const proposed of ["", "7.10", "v7.10.3", "7.10.3-beta.1", "7.10.3\nversion=evil", "../7.10.3", "7.10.3-rc."]) {
    expect(refusal({ ...base, proposed, requested: proposed })).toContain("is not x.y.z or x.y.z-rc.n")
  }
})
