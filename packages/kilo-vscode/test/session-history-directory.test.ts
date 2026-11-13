import { expect, test } from "bun:test"
import { sameSessionDirectory } from "../webview-ui/src/v2/history-directory"

test("history directory comparison accepts trailing slash differences", () => {
  expect(sameSessionDirectory("/workspace/project/", "/workspace/project")).toBe(true)
  expect(sameSessionDirectory("/workspace/project", "/workspace/other")).toBe(false)
})

test("history directory comparison handles Windows case and separators", () => {
  expect(sameSessionDirectory("C:\\Work\\Repo\\", "c:/work/repo")).toBe(true)
  expect(sameSessionDirectory("C:\\Work\\Repo", "D:\\Work\\Repo")).toBe(false)
})

test("POSIX comparisons remain case-sensitive", () => {
  expect(sameSessionDirectory("/Repo", "/repo")).toBe(false)
})
