import { expect, test } from "bun:test"
import { retitle } from "./changeset-version"

test("retitle rewrites only the first heading", () => {
  const content = "## 1.2.2\n\nbody\n\n## 1.2.1\n\nolder\n"
  expect(retitle(content, "1.2.3")).toBe("## 1.2.3\n\nbody\n\n## 1.2.1\n\nolder\n")
})

test("retitle leaves content without headings unchanged", () => {
  const content = "no headings here\n"
  expect(retitle(content, "1.2.3")).toBe(content)
})
