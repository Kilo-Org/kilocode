import { describe, expect, it } from "bun:test"
import type { Part as SDKPart } from "@kilocode/sdk/v2"
import { bundleEdits } from "../../webview-ui/src/components/chat/edit-bundles"

function edit(id: string, file: string, status = "completed") {
  return {
    id,
    sessionID: "session",
    messageID: "message",
    type: "tool",
    callID: `call-${id}`,
    tool: "edit",
    state: {
      status,
      input: { filePath: file },
      metadata: {},
      output: "",
      title: "Edit",
      time: { start: 1, end: 2 },
    },
  } as unknown as SDKPart
}

function text(id: string) {
  return {
    id,
    sessionID: "session",
    messageID: "message",
    type: "text",
    text: "Done",
  } as SDKPart
}

describe("edit bundles", () => {
  it("bundles consecutive edits to the same file and keeps the latest part", () => {
    const groups = bundleEdits([edit("one", "src/app.ts"), edit("two", "src/app.ts"), edit("three", "src/app.ts")])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: "part:one", count: 3, part: { id: "three" } })
  })

  it("preserves ordering across files and non-edit parts", () => {
    const groups = bundleEdits([
      edit("one", "src/app.ts"),
      edit("two", "src/other.ts"),
      edit("three", "src/app.ts"),
      text("text"),
      edit("four", "src/app.ts"),
    ])

    expect(groups.map((group) => [group.key, group.count])).toEqual([
      ["part:one", 1],
      ["part:two", 1],
      ["part:three", 1],
      ["part:text", 1],
      ["part:four", 1],
    ])
  })

  it("keeps failed edits visible instead of bundling them", () => {
    const groups = bundleEdits([
      edit("one", "src/app.ts"),
      edit("failed", "src/app.ts", "error"),
      edit("two", "src/app.ts"),
    ])

    expect(groups.map((group) => group.key)).toEqual(["part:one", "part:failed", "part:two"])
  })
})
