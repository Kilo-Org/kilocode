import { expect, test } from "bun:test"
import { requiresIndexingRestart } from "../../../src/indexing/restart-policy"

test("decides from the supplied readiness and applied settings alone", () => {
  const incomplete = Object.freeze({
    enabled: true,
    configured: false,
    embedderProvider: "openai" as const,
    openAiKey: "test-key",
    fileExtensions: [".ts"],
  })
  const ready = Object.freeze({ ...incomplete, configured: true })

  expect(requiresIndexingRestart(incomplete, ready)).toBe(true)
  expect(requiresIndexingRestart(ready, incomplete)).toBe(false)
  expect(requiresIndexingRestart(ready, ready)).toBe(false)
})
