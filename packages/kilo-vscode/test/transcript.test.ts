import { describe, expect, test } from "bun:test"
import type { FileDiffInfo, SessionMessageAssistantTool } from "@opencode/client"
import { attachmentUri, fileDiffs, relativizeProjectPath, toolOutput } from "../../kilo-ui/src/components/content-data"
import { transcriptRows } from "../webview-ui/src/v2/transcript"

describe("v2 transcript content", () => {
  test("joins text output in content order without treating files as text", () => {
    const item: SessionMessageAssistantTool = {
      type: "tool",
      id: "call",
      name: "read",
      time: { created: 1 },
      state: {
        status: "completed",
        input: { path: "image.png" },
        content: [
          { type: "text", text: "first" },
          { type: "file", uri: "data:image/png;base64,AA==", mime: "image/png" },
          { type: "text", text: "second" },
        ],
      },
    }
    expect(toolOutput(item)).toBe("first\nsecond")
    expect(toolOutput({ ...item, state: { status: "streaming", input: '{"path":' } })).toBe("")
    expect(toolOutput({ ...item, state: { status: "running", input: {}, metadata: {} } })).toBe("")
  })

  test("uses inline attachment data and retains URI-only files", () => {
    expect(attachmentUri({ data: "AA==", mime: "image/png", source: { type: "inline" } })).toBe(
      "data:image/png;base64,AA==",
    )
    expect(attachmentUri({ data: "", mime: "text/plain", source: { type: "uri", uri: "file:///repo/test.ts" } })).toBe(
      "file:///repo/test.ts",
    )
    expect(attachmentUri({ data: "", mime: "text/plain", source: { type: "inline" } })).toBe("")
  })

  test("decodes v2 file diff metadata without accepting v1 file records", () => {
    const diff = {
      file: "a.ts",
      patch: "@@ -1 +1 @@\n-a\n+b\n",
      additions: 1,
      deletions: 1,
      status: "modified",
    } satisfies FileDiffInfo
    expect(fileDiffs([diff, null, { filePath: "a.ts", diff: "+b", type: "update" }])).toEqual([diff])
    expect(fileDiffs(undefined)).toEqual([])
  })

  test("relativizes workspace paths without matching sibling prefixes", () => {
    expect(relativizeProjectPath("/repo/src/a.ts", "/repo/")).toBe("src/a.ts")
    expect(relativizeProjectPath("/repo-old/a.ts", "/repo")).toBe("/repo-old/a.ts")
    expect(relativizeProjectPath("C:\\repo\\src\\a.ts", "C:/repo")).toBe("src/a.ts")
    expect(relativizeProjectPath("/repo", "/repo")).toBe("")
    expect(relativizeProjectPath("/repo/a.ts", "/")).toBe("/repo/a.ts")
  })
})

describe("completion notices", () => {
  const message = (id: string, type: string, data: Record<string, unknown>) =>
    ({ id, type, time: { created: 1 }, ...data }) as never
  const turn = () => [
    message("msg_user", "user", { text: "run it" }),
    message("msg_step", "assistant", {
      agent: "code",
      model: { providerID: "kilo", id: "free" },
      content: [{ type: "text", text: "done" }],
      time: { created: 2, completed: 3 },
    }),
  ]

  test("a subagent completion leaves no notice row", () => {
    const rows = transcriptRows([
      ...turn(),
      message("msg_subagent", "synthetic", {
        text: '<subagent sessionID="ses_child" state="cancelled" description="Recheck scripts package">\n</subagent>',
        description: "Recheck scripts package",
        metadata: { source: "subagent", childID: "ses_child", agent: "Explore", state: "cancelled" },
      }),
    ])
    expect(rows.some((row) => row.type === "notice")).toBe(false)
  })

  test("a shell completion keeps its notice row", () => {
    const rows = transcriptRows([
      ...turn(),
      message("msg_shell", "synthetic", {
        text: "<shell>npm test</shell>",
        description: "npm test",
        metadata: { source: "shell", state: "completed" },
      }),
    ])
    // A backgrounded shell result, a restart, and a shell start failure are only visible as this notice.
    expect(rows.filter((row) => row.type === "notice")).toHaveLength(1)
  })

  test("a goal notice still renders", () => {
    const rows = transcriptRows([
      ...turn(),
      message("msg_goal", "synthetic", { text: "Goal paused", description: "Goal paused", metadata: { source: "goal" } }),
    ])
    expect(rows.filter((row) => row.type === "notice")).toHaveLength(1)
  })
})
