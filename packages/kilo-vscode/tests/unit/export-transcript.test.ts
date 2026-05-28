import { describe, expect, it } from "bun:test"
import { formatTranscript } from "../../src/kilo-provider/export-transcript"

describe("formatTranscript", () => {
  it("formats complete Markdown session exports and skips hidden text", () => {
    const text = formatTranscript(
      {
        id: "ses_123456789",
        slug: "export-test",
        projectID: "project",
        directory: "/repo",
        title: "Export test",
        version: "1",
        time: { created: 1_000, updated: 2_000 },
      } as never,
      [
        {
          info: { role: "user" },
          parts: [
            { type: "text", text: "Please export this." },
            { type: "text", text: "hidden", synthetic: true },
          ],
        },
        {
          info: { role: "assistant" },
          parts: [
            { type: "tool", tool: "read" },
            { type: "text", text: "Saved as Markdown." },
          ],
        },
      ] as never,
    )

    expect(text).toContain("# Export test")
    expect(text).toContain("**Session ID:** ses_123456789")
    expect(text).toContain("## User\n\nPlease export this.")
    expect(text).toContain("## Assistant\n\n**Tool: read**\n\nSaved as Markdown.")
    expect(text).not.toContain("hidden")
  })

  it("keeps an empty session export readable", () => {
    const text = formatTranscript(
      {
        id: "ses_empty",
        slug: "empty",
        projectID: "project",
        directory: "/repo",
        title: "Empty",
        version: "1",
        time: { created: 1_000, updated: 2_000 },
      } as never,
      [],
    )

    expect(text).toContain("# Empty")
    expect(text).toEndWith("---\n\n")
  })
})
