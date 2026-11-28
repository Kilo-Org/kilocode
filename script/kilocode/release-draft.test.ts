import { expect, test } from "bun:test"
import { absent, decide, next, run, type IO, type Release } from "./release-draft"

const marker = "Draft for publish run 42"
const tags = ["v7.8.40", "v7.8.41", "v7.10.2", "v7.9.9", "jetbrains/v1.2.3", "v7.10.3-rc.1", "vnext"]
const published = (id: number, tag: string): Release => ({ id, tag_name: tag, draft: false, body: "notes" })
const draft = (id: number, tag: string, body = "Draft for publish run 7"): Release => ({
  id,
  tag_name: tag,
  draft: true,
  body,
})
const base = { tags, releases: [published(1, "v7.10.2")], marker, requested: "", bump: "patch", prerelease: false }
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

test("the bump of the highest tag, with no draft to reuse", () => {
  expect(decide(base)).toEqual({ version: "7.10.3", tag: "v7.10.3", reuse: undefined })
  expect(decide({ ...base, bump: "minor" }).version).toBe("7.11.0")
})

test("an orphan draft above the highest tag counts", () => {
  const releases = [...base.releases, draft(5, "v7.10.3")]
  expect(decide({ ...base, releases }).version).toBe("7.10.4")
})

test("a re-run reuses its own draft and leaves it out of the highest version", () => {
  const own = draft(9, "v7.10.3", marker)
  expect(decide({ ...base, releases: [...base.releases, own] })).toEqual({
    version: "7.10.3",
    tag: "v7.10.3",
    reuse: own,
  })
  const moved = { ...base, tags: [...tags, "v7.10.3"], releases: [...base.releases, draft(9, "v7.10.3", marker)] }
  expect(refusal(moved)).toContain("This run's draft 9 is for v7.10.3, but the version is now 7.10.4")
})

test("another run's draft of the requested version is refused", () => {
  // A stable draft already counts in the highest version, so a release candidate shows the check.
  const releases = [...base.releases, draft(5, "v7.12.0-rc.1")]
  expect(refusal({ ...base, releases, requested: "7.12.0-rc.1", prerelease: true })).toContain(
    "A release for v7.12.0-rc.1 already exists: 5 (draft of another run)",
  )
  const stable = [...base.releases, draft(6, "v7.12.0")]
  expect(refusal({ ...base, releases: stable, requested: "7.12.0" })).toContain(
    "is not above the highest version 7.12.0",
  )
})

test("an existing tag or release is refused", () => {
  expect(refusal({ ...base, requested: "7.10.3-rc.1", prerelease: true })).toContain("Tag v7.10.3-rc.1 already exists")
  const releases = [...base.releases, published(3, "v7.12.0-rc.1")]
  expect(refusal({ ...base, releases, requested: "7.12.0-rc.1", prerelease: true })).toContain(
    "A release for v7.12.0-rc.1 already exists: 3.",
  )
})

test("a requested version must be valid, and a stable one above the highest version", () => {
  expect(decide({ ...base, requested: "7.12.0" }).version).toBe("7.12.0")
  expect(decide({ ...base, requested: "7.10.4-rc.2", prerelease: true }).version).toBe("7.10.4-rc.2")
  // A release candidate's x.y.z must be above the highest plain version too.
  expect(refusal({ ...base, requested: "7.10.2-rc.1", prerelease: true })).toContain(
    "The requested version 7.10.2-rc.1 is not above the highest version 7.10.2",
  )
  expect(refusal({ ...base, requested: "7.9.0-rc.1", prerelease: true })).toContain("is not above the highest version")
  expect(refusal({ ...base, requested: "7.10.2" })).toContain("is not above the highest version 7.10.2")
  expect(refusal({ ...base, requested: "6.0.0" })).toContain("is not above the highest version 7.10.2")
  const orphan = [...base.releases, draft(5, "v7.11.0")]
  expect(refusal({ ...base, releases: orphan, requested: "7.10.9" })).toContain(
    "is not above the highest version 7.11.0",
  )
  expect(refusal({ ...base, requested: "7.12.0-rc.2" })).toContain("pre_release is false")
  for (const requested of ["7.10", "v7.10.4", "7.10.4-beta.1", "7.10.4\nversion=evil", "../7.10.4", "7.10.4-rc."]) {
    expect(refusal({ ...base, requested })).toContain("is not x.y.z or x.y.z-rc.n")
  }
})

test("the tag lookup right before creating: only HTTP 404 lets it through", () => {
  expect(() => absent("v1.0.0", { exitCode: 1, stderr: "gh: Not Found (HTTP 404)" })).not.toThrow()
  expect(() => absent("v1.0.0", { exitCode: 0, stderr: "" })).toThrow("Tag v1.0.0 already exists")
  expect(() => absent("v1.0.0", { exitCode: 1, stderr: "gh: Bad Gateway (HTTP 502)" })).toThrow(
    "Could not check tag v1.0.0: gh: Bad Gateway (HTTP 502)",
  )
})

function io(input: { releases?: Release[]; ref?: { exitCode: number; stderr: string } }) {
  const created: string[] = []
  const value: IO = {
    tags: async () => tags,
    releases: async () => input.releases ?? base.releases,
    ref: async () => input.ref ?? { exitCode: 1, stderr: "HTTP 404" },
    create: async ({ tag }) => {
      created.push(tag)
      return { id: 77, tag_name: tag }
    },
  }
  return { value, created }
}
const inputs = { requested: "", bump: "patch", prerelease: false, marker }

test("run creates the draft only after the tag lookup says not found", async () => {
  const ok = io({})
  expect(await run(ok.value, inputs)).toEqual({ version: "7.10.3", release: "77", tag: "v7.10.3" })
  expect(ok.created).toEqual(["v7.10.3"])
  const failed = io({ ref: { exitCode: 1, stderr: "HTTP 500" } })
  expect(await run(failed.value, inputs).catch((err: Error) => err.message)).toContain("Could not check tag v7.10.3")
  expect(failed.created).toEqual([])
})

test("run reuses this run's draft without creating another", async () => {
  const again = io({ releases: [...base.releases, draft(9, "v7.10.3", marker)] })
  expect(await run(again.value, inputs)).toEqual({ version: "7.10.3", release: "9", tag: "v7.10.3" })
  expect(again.created).toEqual([])
})
