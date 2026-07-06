import { expect, test } from "bun:test"
import { buildNotes } from "./release-notes"

const section = (version: string, body: string) => `## ${version}\n\n${body}\n`
const release = (tagName: string, isPrerelease = false, isDraft = false) => ({ tagName, isPrerelease, isDraft })

test("prerelease notes contain only their own section", () => {
  const changelog = section("1.2.3", "current prerelease") + section("1.2.2", "previous prerelease")
  const notes = buildNotes({
    version: "1.2.3",
    prerelease: true,
    releases: [release("v1.2.2", true)],
    changelog,
  })

  expect(notes).toBe("current prerelease")
})

test("stable notes contain only published prereleases since the previous stable", () => {
  const changelog = [
    section("1.2.6", "final"),
    section("1.2.5", "published prerelease"),
    section("1.2.4", "draft prerelease"),
    section("1.2.3", "unpublished section"),
    section("1.2.1", "previous stable"),
    section("1.2.0", "older prerelease"),
  ].join("\n")
  const notes = buildNotes({
    version: "1.2.6",
    prerelease: false,
    releases: [release("v1.2.5", true), release("v1.2.4", true, true), release("v1.2.1"), release("v1.2.0", true)],
    changelog,
  })

  expect(notes).toBe("## 1.2.6\n\nfinal\n\n## 1.2.5\n\npublished prerelease")
})

test("stable notes include prereleases when the current section is empty", () => {
  const notes = buildNotes({
    version: "1.2.3",
    prerelease: false,
    releases: [release("v1.2.2", true), release("v1.2.1")],
    changelog: section("1.2.3", "") + section("1.2.2", "prerelease") + section("1.2.1", "stable"),
  })

  expect(notes).toBe("## 1.2.2\n\nprerelease")
})

test("missing and empty prerelease sections use the fallback", () => {
  expect(buildNotes({ version: "2.0.0", prerelease: true, releases: [], changelog: "" })).toBe("No notable changes")
  expect(buildNotes({ version: "2.0.0", prerelease: true, releases: [], changelog: section("2.0.0", "") })).toBe(
    "No notable changes",
  )
  expect(buildNotes({ version: "2.0.0", prerelease: false, releases: [release("v1.9.0", true)], changelog: "" })).toBe(
    "No notable changes",
  )
})
