import { expect, test } from "bun:test"
import { DateTime } from "effect"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

test("compaction split does not duplicate the cut entry in head and recent", () => {
  const entry = (index: number) => ({
    seq: index,
    message: SessionMessage.System.make({
      id: SessionMessage.ID.make(`msg_sys${index}`),
      type: "system",
      text: `START${index}${"x".repeat(390)}END${index}`,
      time: { created: DateTime.makeUnsafe(index) },
    }),
  })
  // Each entry serializes to 417 chars (~104 tokens); a 250-token budget fits
  // the two newest entries, then splits the third across head and recent.
  const selected = SessionCompaction.select([0, 1, 2, 3].map(entry), 250)

  expect(selected).toBeDefined()
  expect(selected!.head).toContain("START0")
  expect(selected!.head).toContain("END0")
  expect(selected!.head).toContain("START1")
  expect(selected!.head).not.toContain("END1")
  expect(selected!.head).not.toContain("START2")
  expect(selected!.recent).not.toContain("START1")
  expect(selected!.recent).toContain("END1")
  expect(selected!.recent).toContain("START2")
  expect(selected!.recent).toContain("END3")
})
