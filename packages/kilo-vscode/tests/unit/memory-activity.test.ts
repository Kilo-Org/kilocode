import { describe, expect, it } from "bun:test"
import { MemoryMarkerMeta } from "@kilocode/kilo-memory/marker-meta"
import { addMemoryActivity, markerActivity } from "../../webview-ui/src/utils/memory-activity"

describe("memory activity", () => {
  it("accumulates saved events with their message and source references", () => {
    const items = addMemoryActivity(
      [],
      {
        type: "saved",
        message: "Saved project memory",
        operationCount: 4,
        added: 3,
        removed: 1,
        sources: ["project.md:kilo_colors"],
      },
      10,
    )

    expect(items).toEqual([
      {
        type: "saved",
        at: 10,
        tokens: 0,
        count: 3,
        items: ["Saved project memory"],
        refs: ["project.md:kilo_colors"],
      },
    ])
    expect(addMemoryActivity(items, { type: "recalled" }, 20)).toEqual(items)
  })

  it("ignores removal-only events and caps saved activity", () => {
    const removed = { type: "saved" as const, message: "Memory updated · 1 removed", added: 0, removed: 1 }
    expect(addMemoryActivity([], removed, 10)).toEqual([])

    const items = Array.from({ length: 60 }).reduce(
      (all, _, at) => addMemoryActivity(all, { type: "saved", added: 1 }, at),
      [] as ReturnType<typeof addMemoryActivity>,
    )
    expect(items).toHaveLength(50)
    expect(items[0]?.at).toBe(10)
    expect(items.at(-1)?.at).toBe(59)
  })

  it("decodes loaded and recalled markers for activity summaries", () => {
    const loaded = markerActivity(
      [
        {
          type: "text",
          metadata: MemoryMarkerMeta.metadata(
            {
              type: "startup",
              bytes: 10,
              tokens: 42,
              count: 1,
              files: ["project.md"],
              items: ["Use Kilo colors"],
            },
            true,
          ),
        },
      ],
      10,
    )
    const recalled = markerActivity(
      [
        {
          type: "text",
          metadata: MemoryMarkerMeta.metadata(
            {
              type: "recall",
              bytes: 10,
              tokens: 8,
              count: 2,
              files: ["project.md"],
              items: ["Prefer dark mode"],
            },
            true,
          ),
        },
      ],
      20,
    )

    expect(loaded).toMatchObject({ type: "loaded", tokens: 42, count: 1, items: [] })
    expect(recalled).toMatchObject({ type: "recalled", tokens: 8, count: 2, items: ["Prefer dark mode"] })
  })
})
