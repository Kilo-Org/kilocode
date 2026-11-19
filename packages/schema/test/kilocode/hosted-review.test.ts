import { expect, test } from "bun:test"
import { Schema } from "effect"
import { HostedReview } from "../../src/kilocode/hosted-review.js"

test("review file selections are repository-relative, revision-pinned and scope-specific", () => {
  const valid = { path: "pkg/a file.ts", revision: 2, scope: "uncommitted" }
  expect(Schema.is(HostedReview.Selection)(valid)).toBe(true)
  for (const path of ["", "/repo/a", "../a", "a/./b", "a//b", "a\\b", "C:/a", "a\0b"]) {
    expect(Schema.is(HostedReview.Selection)({ ...valid, path })).toBe(false)
  }
  expect(Schema.is(HostedReview.Selection)({ ...valid, revision: 0 })).toBe(false)
  expect(Schema.is(HostedReview.Selection)({ ...valid, scope: "local" })).toBe(false)
})
