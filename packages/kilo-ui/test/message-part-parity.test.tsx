import { afterEach, beforeEach, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, ToolFileContent } from "@opencode/client"
import { File } from "../src/components/file"
import { ContentPart, type ToolActionDiff } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { DialogProvider } from "../src/context/dialog"
import { FileComponentProvider } from "../src/context/file"
import { MarkedProvider } from "../src/context/marked"
import { patchedFiles } from "./fixtures"
import { mount, mountTool, waitFor, type Mounted } from "./harness"

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

function mountPart(
  item: SessionMessageAssistant["content"][number],
  props: Parameters<typeof ContentPart>[0] = {} as never,
) {
  const message = {
    id: "message-1",
    type: "assistant",
    time: { created: 1, completed: 2 },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    content: [item],
  } as unknown as SessionMessageAssistant
  const card = mount(() => (
    <DialogProvider>
      <MarkedProvider>
        <FileComponentProvider component={File}>
          <ContentPart item={item} message={message} index={0} {...props} />
        </FileComponentProvider>
      </MarkedProvider>
    </DialogProvider>
  ))
  mounted.push(card)
  return card
}

function tool(name: string, state: SessionMessageAssistantTool["state"], id = "part-1"): SessionMessageAssistantTool {
  return { type: "tool", id, name, time: { created: 1 }, state }
}

function file(overrides: Partial<ToolFileContent>): ToolFileContent {
  return { type: "file", uri: "data:image/png;base64,AA==", mime: "image/png", name: "shot.png", ...overrides }
}

test("skill card prefers the loaded skill name over the input id", async () => {
  const named = mountTool("skill", {
    input: { id: "pdf" },
    metadata: { name: "PDF Tools" },
    partID: "skill-name",
  })
  mounted.push(named)
  await waitFor(() => named.host.querySelector('[data-slot="basic-tool-tool-subtitle"]'))
  expect(named.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toBe("PDF Tools")

  const fallback = mountTool("skill", {
    input: { id: "pdf" },
    metadata: {},
    partID: "skill-id",
  })
  mounted.push(fallback)
  await waitFor(() => fallback.host.querySelector('[data-slot="basic-tool-tool-subtitle"]'))
  expect(fallback.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toBe("pdf")
})

test("custom tool card shows a file path, one extra argument, pretty output and attachments", async () => {
  const card = mountPart(
    tool("github-pr-search", {
      status: "completed",
      input: { filePath: "src/app.ts", per_page: 5, nested: { ignored: true } },
      metadata: {},
      content: [
        { type: "text", text: '{"total_count":1,"items":[]}' },
        file({}),
        file({ mime: "application/pdf", name: "report.pdf" }),
      ],
    }),
    { forceOpen: true } as never,
  )
  await waitFor(() => card.host.querySelector('[data-slot="mcp-section-label"]'))

  const trigger = card.host.querySelector('[data-slot="basic-tool-tool-info-structured"]')
  expect(trigger?.textContent).toContain("github-pr-search")
  expect(trigger?.textContent).toContain("src/app.ts")
  expect(trigger?.textContent).toContain("per_page=5")
  expect(trigger?.textContent).not.toContain("nested")

  const outputs = await waitFor(() => {
    const nodes = [...card.host.querySelectorAll('[data-component="tool-output"]')]
    return nodes.some((node) => node.textContent?.includes('"total_count": 1')) ? nodes : undefined
  })
  expect(outputs.some((node) => node.textContent?.includes('"total_count": 1'))).toBe(true)
  expect(card.host.querySelector('[data-slot="tool-read-image-img"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="mcp-attachment"]')?.textContent).toContain("report.pdf")
})

test("edit failures that need a read become a hint instead of an error card", async () => {
  const card = mountPart(
    tool("edit", {
      status: "error",
      input: { path: "src/app.ts" },
      metadata: {},
      error: {
        type: "tool.execution",
        message: "Error: oldString and newString are identical. No changes were made.",
      },
    }),
  )
  await waitFor(() => card.host.querySelector('[data-component="tool-hint"]'))
  expect(card.host.querySelector('[data-component="tool-hint"]')?.textContent).toContain(
    "oldString and newString are identical",
  )
  expect(card.host.querySelector('[data-component="tool-error"]')).toBeNull()
})

test("a long error message keeps the error type and HTTP status", async () => {
  const card = mountPart(
    tool("bash", {
      status: "error",
      input: {},
      metadata: {},
      error: {
        type: "provider.error",
        status: 401,
        message: "The provider rejected the request because the key is invalid",
      },
    }),
  )
  await waitFor(() => card.host.querySelector('[data-slot="message-part-tool-error-title"]'))
  expect(card.host.querySelector('[data-slot="message-part-tool-error-title"]')?.textContent).toBe("provider.error")
  expect(card.host.querySelector('[data-slot="message-part-tool-error-code"]')?.textContent).toBe("401")
  expect(card.host.querySelector('[data-slot="message-part-tool-error-message"]')?.textContent).toBe(
    "The provider rejected the request because the key is invalid",
  )
})

test("an HTTP code only strips at a token boundary", async () => {
  const card = mountPart(
    tool("bash", {
      status: "error",
      input: {},
      metadata: {},
      error: { type: "tool.execution", status: 500, message: "Timeout: 5000 ms timeout" },
    }),
  )
  await waitFor(() => card.host.querySelector('[data-slot="message-part-tool-error-message"]'))
  expect(card.host.querySelector('[data-slot="message-part-tool-error-title"]')?.textContent).toBe("Timeout")
  expect(card.host.querySelector('[data-slot="message-part-tool-error-message"]')?.textContent).toBe("5000 ms timeout")
})

test("a multiple-match edit failure becomes a hint", async () => {
  const card = mountPart(
    tool("edit", {
      status: "error",
      input: { path: "src/app.ts" },
      metadata: {},
      error: {
        type: "tool.execution",
        message:
          "Found 3 matches for oldString, but expected exactly one. Add more surrounding context to make oldString unique, or set replaceAll to true to replace every occurrence.",
      },
    }),
  )
  await waitFor(() => card.host.querySelector('[data-component="tool-hint"]'))
  expect(card.host.querySelector('[data-component="tool-hint"]')?.textContent).toContain(
    "matches for oldString, but expected exactly one",
  )
  expect(card.host.querySelector('[data-component="tool-error"]')).toBeNull()
})

test("a subagent failure shows its message as the error title", async () => {
  const card = mountPart(
    tool("subagent", {
      status: "error",
      input: { agent: "general", description: "Inspect parser" },
      metadata: {},
      error: { type: "tool.execution", message: "Task failed" },
    }),
  )
  await waitFor(() => card.host.querySelector('[data-slot="message-part-tool-error-title"]'))
  expect(card.host.querySelector('[data-slot="message-part-tool-error-title"]')?.textContent).toBe("Task failed")
  expect(card.host.querySelector('[data-component="tool-error"]')?.textContent).not.toContain("tool.execution")
})

test("read card lists loaded instruction files and opens them", async () => {
  const opened: string[] = []
  const card = mountPart(
    tool("read", {
      status: "completed",
      input: { path: "src/math.ts" },
      metadata: { loaded: ["/repo/AGENTS.md", "/repo/src/AGENTS.md", 42] },
      content: [{ type: "text", text: "Read file src/math.ts, lines 1-1" }],
    }),
    {
      directory: "/repo",
      actions: { openFile: (path: string) => opened.push(path) },
    } as never,
  )
  await waitFor(() => card.host.querySelector('[data-component="tool-loaded-file"]'))
  const rows = [...card.host.querySelectorAll('[data-component="tool-loaded-file"]')]
  expect(rows).toHaveLength(2)
  expect(rows[0]?.textContent).toContain("Loaded AGENTS.md")
  expect(rows[1]?.textContent).toContain("Loaded src/AGENTS.md")

  rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  expect(opened).toEqual(["/repo/AGENTS.md"])
})

test("todowrite renders done, started and hidden rows of a compact view", async () => {
  const card = mountTool("todowrite", {
    input: {
      todos: [
        { content: "First", status: "completed" },
        { content: "Second", status: "in_progress" },
        { content: "Third", status: "pending" },
        { content: "Fourth", status: "pending" },
      ],
    },
    metadata: {
      todos: [
        { content: "First", status: "completed" },
        { content: "Second", status: "in_progress" },
        { content: "Third", status: "pending" },
        { content: "Fourth", status: "pending" },
      ],
      view: {
        mode: "compact",
        todos: [
          { content: "Second", status: "in_progress", started: true, changed: true },
          { content: "Third", status: "completed", done: true, changed: true },
        ],
        hiddenBefore: 1,
        hiddenAfter: 1,
      },
    },
    partID: "todos-compact",
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-component="todos"]'))

  const hidden = [...card.host.querySelectorAll('[data-slot="message-part-todo-hidden"]')].map((row) => row.textContent)
  expect(hidden).toEqual(["1 earlier to-do hidden", "1 later to-do hidden"])
  const boxes = [...card.host.querySelectorAll('[data-component="checkbox"]')]
  expect(boxes).toHaveLength(2)
  expect(boxes[0]?.hasAttribute("data-started")).toBe(true)
  expect(boxes[1]?.hasAttribute("data-done")).toBe(true)
  expect(card.host.querySelector('[data-slot="message-part-todo-content"][data-changed="changed"]')).not.toBeNull()
})

test("streamed edit input shows provisional change counts while the call runs", async () => {
  const card = mountPart(
    tool("edit", {
      status: "streaming",
      input: '{"path":"src/math.ts","oldString":"a\\nb\\n","newString":"a\\nb\\nc\\n"',
    }),
  )
  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]'))
  expect(card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent).toBe("+3")
  expect(card.host.querySelector('[data-slot="diff-changes-deletions"]')?.textContent).toBe("-2")
})

test("streamed write input shows provisional change counts while the call runs", async () => {
  const card = mountPart(
    tool("write", {
      status: "streaming",
      input: '{"path":"src/notes.md","content":"# Notes\\nFixture content.\\n"',
    }),
  )
  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]'))
  expect(card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent).toBe("+2")
  expect(card.host.querySelector('[data-slot="diff-changes-deletions"]')?.textContent).toBe("-0")
})

test("running subagent card can stop the child or continue in the background", async () => {
  const stopped: string[] = []
  let background = 0
  const card = mountTool("subagent", {
    input: { agent: "general", description: "Inspect parser" },
    metadata: { sessionID: "child-1", status: "running" },
    status: "running",
    partID: "subagent-actions",
    actions: {
      interruptSession: (id) => stopped.push(id),
      continueInBackground: () => background++,
    },
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-slot="task-tool-open"]'))

  const stop = await waitFor(() => card.host.querySelector<HTMLElement>('[data-action="stop"]'))
  stop.click()
  expect(stopped).toEqual(["child-1"])

  const promote = await waitFor(() => card.host.querySelector<HTMLElement>('[data-action="background"]'))
  promote.click()
  expect(background).toBe(1)
})

test("a multi-file patch opens every file with one diff action", async () => {
  const opened: ToolActionDiff[][] = []
  const card = mountTool("patch", {
    input: { patchText: patchedFiles.map((entry) => entry.patch).join("") },
    metadata: { files: patchedFiles },
    partID: "patch-open-all",
    directory: "/repo",
    forceOpen: true,
    actions: { openDiffs: (diffs) => opened.push(diffs) },
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelectorAll('[data-slot="apply-patch-filename"]').length === 2)

  const action = await waitFor(() =>
    card.host.querySelector<HTMLElement>(
      '[data-slot="apply-patch-open-all"] [aria-label="ui.messagePart.openInDiffViewer"]',
    ),
  )
  expect(action).not.toBeNull()
  action?.click()

  expect(opened).toHaveLength(1)
  expect(opened[0]?.map((entry) => entry.file)).toEqual(["src/math.ts", "src/legacy.ts"])
  expect(opened[0]?.[0]?.additions).toBe(1)
  expect(opened[0]?.[1]?.deletions).toBe(1)
})

test("a malformed patch file is skipped and reported", async () => {
  const opened: ToolActionDiff[][] = []
  const files = [
    ...patchedFiles,
    { ...patchedFiles[0], file: "src/broken.ts", patch: "@@ broken", additions: 0, deletions: 0 },
  ]
  const card = mountTool("patch", {
    input: { patchText: files.map((entry) => entry.patch).join("") },
    metadata: { files },
    partID: "patch-open-all-broken",
    directory: "/repo",
    forceOpen: true,
    actions: { openDiffs: (diffs) => opened.push(diffs) },
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelectorAll('[data-slot="apply-patch-filename"]').length === 3)

  const action = await waitFor(() =>
    card.host.querySelector<HTMLElement>(
      '[data-slot="apply-patch-open-all"] [aria-label="ui.messagePart.openInDiffViewer"]',
    ),
  )
  action?.click()

  expect(opened).toHaveLength(1)
  expect(opened[0]?.map((entry) => entry.file)).toEqual(["src/math.ts", "src/legacy.ts"])
  expect(card.host.querySelector('[data-slot="apply-patch-open-all-invalid"]')?.textContent).toContain("src/broken.ts")
})
