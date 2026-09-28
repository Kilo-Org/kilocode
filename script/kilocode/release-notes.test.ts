import { expect, test } from "bun:test"
import { buildNotes, buildReleaseNotes } from "./release-notes"

const section = (version: string, body: string) => `## ${version}\n\n${body}\n`
const release = (tagName: string, isPrerelease = false, isDraft = false) => ({ tagName, isPrerelease, isDraft })

test("release notes include VS Code and CLI changes with nested headings", () => {
  expect(
    buildReleaseNotes({
      version: "7.5.16",
      prerelease: false,
      releases: [],
      vscode: section("7.5.16", "### Minor Changes\n\n- Improve Agent Manager"),
      cli: section("7.5.16", "### Patch Changes\n\n- #13896 Fix session list --all"),
    }),
  ).toBe(
    "## VS Code\n\n### 7.5.16\n\n#### Minor Changes\n\n- Improve Agent Manager\n\n" +
      "## CLI\n\n### 7.5.16\n\n#### Patch Changes\n\n- #13896 Fix session list --all",
  )
})

test("combined notes retain channel filtering for both packages", () => {
  const input = {
    version: "1.2.3",
    releases: [release("v1.2.2", true), release("v1.2.1")],
    vscode: section("1.2.3", "editor") + section("1.2.2", "editor preview") + section("1.2.1", "old editor"),
    cli: section("1.2.3", "cli") + section("1.2.2", "cli preview") + section("1.2.1", "old cli"),
  }
  expect(buildReleaseNotes({ ...input, prerelease: true })).toBe("## VS Code\n\neditor\n\n## CLI\n\ncli")
  expect(buildReleaseNotes({ ...input, prerelease: false })).toBe(
    "## VS Code\n\n### 1.2.3\n\neditor\n\n### 1.2.2\n\neditor preview\n\n" +
      "## CLI\n\n### 1.2.3\n\ncli\n\n### 1.2.2\n\ncli preview",
  )
})

test("combined notes omit empty packages and use one fallback when both are empty", () => {
  const input = { version: "1.2.3", prerelease: true, releases: [] }
  expect(buildReleaseNotes({ ...input, vscode: "", cli: section("1.2.3", "fix") })).toBe("## CLI\n\nfix")
  expect(buildReleaseNotes({ ...input, vscode: section("1.2.3", "fix"), cli: "" })).toBe("## VS Code\n\nfix")
  expect(buildReleaseNotes({ ...input, vscode: "", cli: section("1.2.3", "") })).toBe("No notable changes")
})

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
