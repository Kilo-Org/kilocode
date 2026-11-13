import { afterEach, beforeEach, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client"
import type { ToolActionDiff } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { editedFile, patchedFiles, unchangedFile, writtenFile } from "./fixtures"
import { mountRich, mountTool, trigger, waitFor, type Mounted } from "./harness"
import { ContentPart } from "../src/components/message-part"

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

function openDiff() {
  const calls: ToolActionDiff[] = []
  return { calls, action: (diff: ToolActionDiff) => calls.push(diff) }
}

test("edit card renders the file header, change counts and the real diff body", async () => {
  const diff = openDiff()
  const card = mountTool("edit", {
    input: { path: "src/math.ts" },
    metadata: { files: [editedFile] },
    partID: "edit-card",
    directory: "/repo",
    actions: { openDiff: diff.action },
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-component="edit-content"] [data-component="file"]'))

  expect(card.host.querySelector('[data-component="edit-tool"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="message-part-title-text"]')?.textContent).toBe("Edit")
  expect(card.host.querySelector('[data-slot="message-part-title-filename"]')?.textContent).toBe("math.ts")
  expect(card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent).toBe("+1")
  expect(card.host.querySelector('[data-slot="diff-changes-deletions"]')?.textContent).toBe("-0")
  expect(card.host.querySelector('[data-component="edit-content"] [data-component="file"]')).not.toBeNull()

  const action = card.host.querySelector<HTMLElement>('[aria-label="ui.messagePart.openInDiffViewer"]')
  action?.click()

  expect(diff.calls).toHaveLength(1)
  expect(diff.calls[0]).toMatchObject({ file: "src/math.ts", additions: 1, deletions: 0 })
  expect(diff.calls[0]?.patch).toContain("+export const NAME")
})

test("write card renders the written file and its diff", async () => {
  const card = mountTool("write", {
    input: { path: "src/notes.md", content: "# Notes\nFixture content.\n" },
    metadata: { files: [writtenFile] },
    partID: "write-card",
    directory: "/repo",
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-component="write-content"] [data-component="file"]'))

  expect(card.host.querySelector('[data-component="write-tool"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="message-part-title-text"]')?.textContent).toBe("Write")
  expect(card.host.querySelector('[data-slot="message-part-title-filename"]')?.textContent).toBe("notes.md")
  expect(card.host.querySelector('[data-component="write-content"] [data-component="file"]')).not.toBeNull()
})

test("read, edit and write cards open their file from the header action", async () => {
  const opened: string[] = []
  const action = (path: string) => opened.push(path)

  const read = mountTool("read", {
    input: { path: "README.md" },
    partID: "read-open",
    directory: "/repo",
    actions: { openFile: action },
  })
  mounted.push(read)
  const readButton = await waitFor(() =>
    read.host.querySelector<HTMLElement>('[aria-label="ui.messagePart.openInEditor"]'),
  )
  readButton.click()

  const edit = mountTool("edit", {
    input: { path: "src/math.ts" },
    metadata: { files: [editedFile] },
    partID: "edit-open",
    directory: "/repo",
    actions: { openFile: action },
  })
  mounted.push(edit)
  const editButton = await waitFor(() =>
    edit.host.querySelector<HTMLElement>('[aria-label="ui.messagePart.openInEditor"]'),
  )
  editButton.click()

  const write = mountTool("write", {
    input: { path: "src/notes.md", content: "# Notes\n" },
    metadata: { files: [writtenFile] },
    partID: "write-open",
    directory: "/repo",
    actions: { openFile: action },
  })
  mounted.push(write)
  const writeButton = await waitFor(() =>
    write.host.querySelector<HTMLElement>('[aria-label="ui.messagePart.openInEditor"]'),
  )
  writeButton.click()

  expect(opened).toEqual(["README.md", "src/math.ts", "src/notes.md"])
})

test("clicking a patch file name opens that file", async () => {
  const opened: string[] = []
  const card = mountTool("patch", {
    input: { patchText: editedFile.patch },
    metadata: { files: [editedFile] },
    partID: "patch-open",
    directory: "/repo",
    actions: { openFile: (path: string) => opened.push(path) },
    forceOpen: true,
  })
  mounted.push(card)
  const name = await waitFor(() => card.host.querySelector<HTMLElement>('[data-slot="message-part-title-filename"]'))
  name.click()

  expect(opened).toEqual(["src/math.ts"])
})

test("an unchanged write hides its details", async () => {
  const card = mountTool("write", {
    input: { path: "src/notes.md", content: "# Notes\nFixture content.\n" },
    metadata: { files: [unchangedFile] },
    partID: "write-unchanged",
    directory: "/repo",
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(
    () => card.host.querySelector('[data-component="tool-trigger"]')?.getAttribute("data-hide-details") === "true",
  )

  expect(card.host.querySelector('[data-component="write-content"]')).toBeNull()
  expect(card.host.querySelector('[data-component="tool-trigger"]')?.getAttribute("data-hide-details")).toBe("true")
})

test("patch card renders a single file with its diff", async () => {
  const card = mountTool("patch", {
    input: { patchText: editedFile.patch },
    metadata: { files: [editedFile] },
    partID: "patch-single",
    directory: "/repo",
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-component="apply-patch-file-diff"] [data-component="file"]'))

  expect(card.host.querySelector('[data-component="apply-patch-tool"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="message-part-title-text"]')?.textContent).toBe("Patch")
  expect(card.host.querySelector('[data-slot="apply-patch-filename"]')?.textContent).toBe("math.ts")
  expect(card.host.querySelector('[data-component="apply-patch-file-diff"] [data-component="file"]')).not.toBeNull()
})

test("patch card lists every file in a multi-file patch", async () => {
  const card = mountTool("patch", {
    input: { patchText: patchedFiles.map((file) => file.patch).join("") },
    metadata: { files: patchedFiles },
    partID: "patch-multi",
    directory: "/repo",
    forceOpen: true,
  })
  mounted.push(card)
  await waitFor(() => card.host.querySelectorAll('[data-slot="apply-patch-filename"]').length === 2)

  const names = [...card.host.querySelectorAll('[data-slot="apply-patch-filename"]')].map((node) => node.textContent)
  expect(names).toEqual(["math.ts", "legacy.ts"])
  expect(card.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toContain("2 files")
  expect(card.host.querySelector('[data-slot="apply-patch-change"][data-type="removed"]')).not.toBeNull()
})

for (const [name, input] of [
  ["grep", { pattern: "marker", path: "src" }],
  ["glob", { pattern: "**/*.ts", path: "src" }],
] as const) {
  test(`${name} card defers its output body until the card expands`, async () => {
    const card = mountTool(name, { input, output: "src/a.ts:1: marker", partID: `${name}-defer` })
    mounted.push(card)

    expect(card.host.querySelector('[data-component="tool-output"]')).toBeNull()

    trigger(card.host).click()
    expect(card.host.querySelector('[data-component="tool-output"]')).toBeNull()

    const output = await waitFor(() => card.host.querySelector('[data-component="tool-output"]'))
    expect(output.textContent).toContain("marker")
  })
}

test("a deferred tool card opened by default mounts its output", async () => {
  const card = mountTool("grep", {
    input: { pattern: "marker", path: "src" },
    output: "src/a.ts:1: marker",
    partID: "grep-default-open",
    defaultOpen: true,
  })
  mounted.push(card)

  const output = await waitFor(() => card.host.querySelector('[data-component="tool-output"]'))
  expect(output.textContent).toContain("marker")
})

test("a deferred MCP card opened by a display layout mounts its body", async () => {
  const message = {
    id: "mcp-message",
    type: "assistant" as const,
    time: { created: 1 },
    agent: "default",
    model: { id: "test", providerID: "test" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    content: [],
  }
  const item = {
    type: "tool" as const,
    id: "mcp-default-open",
    name: "sample_docs_lookup",
    state: {
      status: "completed" as const,
      input: { query: "marker" },
      content: [{ type: "text" as const, text: "result" }],
      metadata: {},
    },
    time: { created: 1 },
  }
  const card = mountRich(() => <ContentPart item={item} message={message} index={0} defaultOpen />)
  mounted.push(card)

  const body = await waitFor(() => card.host.querySelector('[data-slot="mcp-section-label"]'))
  expect(body).not.toBeNull()
})

const liveMessage: SessionMessageAssistant = {
  id: "live-message",
  type: "assistant",
  time: { created: 1 },
  agent: "default",
  model: { id: "test", providerID: "test" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  content: [],
}

function liveTool(name: string, state: SessionMessageAssistantTool["state"]): SessionMessageAssistantTool {
  return { type: "tool", id: `live-${name}`, name, state, time: { created: 1 } }
}

function counts(host: ParentNode) {
  return {
    additions: host.querySelector('[data-slot="diff-changes-additions"]')?.textContent,
    deletions: host.querySelector('[data-slot="diff-changes-deletions"]')?.textContent,
  }
}

test("a streaming write card shows its path and provisional counts", async () => {
  const item = liveTool("write", {
    status: "streaming",
    input: '{"path":"src/notes.md","content":"# Notes\\nFixture content.\\nThird',
  })
  const card = mountRich(() => <ContentPart item={item} message={liveMessage} index={0} />)
  mounted.push(card)

  const filename = await waitFor(() => card.host.querySelector('[data-slot="message-part-title-filename"]'))
  expect(filename.textContent).toBe("notes.md")
  expect(counts(card.host)).toEqual({ additions: "+3", deletions: "-0" })
})

test("a streaming write card shows counts before its path streams", async () => {
  const item = liveTool("write", { status: "streaming", input: '{"content":"one\\ntwo\\nthree' })
  const card = mountRich(() => <ContentPart item={item} message={liveMessage} index={0} />)
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]'))
  expect(card.host.querySelector('[data-slot="message-part-title-filename"]')).toBeNull()
  expect(counts(card.host)).toEqual({ additions: "+3", deletions: "-0" })
})

test("a streaming edit card shows counts before its path streams", async () => {
  const item = liveTool("edit", { status: "streaming", input: '{"oldString":"x","newString":"y\\nz' })
  const card = mountRich(() => <ContentPart item={item} message={liveMessage} index={0} />)
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]'))
  expect(card.host.querySelector('[data-slot="message-part-title-filename"]')).toBeNull()
  expect(counts(card.host)).toEqual({ additions: "+2", deletions: "-1" })
})

test("running edit and patch cards show provisional counts until the final diff arrives", async () => {
  const edit = liveTool("edit", {
    status: "running",
    input: { path: "src/math.ts", oldString: "x", newString: "y\nz" },
    metadata: {},
  })
  const editCard = mountRich(() => <ContentPart item={edit} message={liveMessage} index={0} />)
  mounted.push(editCard)
  await waitFor(() => editCard.host.querySelector('[data-slot="message-part-title-filename"]'))
  expect(counts(editCard.host)).toEqual({ additions: "+2", deletions: "-1" })

  const patch = liveTool("patch", {
    status: "running",
    input: { patchText: "*** Begin Patch\n*** Update File: a.ts\n@@\n-a\n+b\n+c\n*** End Patch" },
    metadata: {},
  })
  const patchCard = mountRich(() => <ContentPart item={patch} message={liveMessage} index={0} />)
  mounted.push(patchCard)
  await waitFor(() => patchCard.host.querySelector('[data-slot="message-part-tool-changes"]'))
  expect(counts(patchCard.host)).toEqual({ additions: "+2", deletions: "-1" })
})

test("a completed write card replaces the provisional counts with the final diff", async () => {
  const [item, setItem] = createSignal<SessionMessageAssistantTool>(
    liveTool("write", {
      status: "streaming",
      input: '{"path":"src/notes.md","content":"# Notes\\nFixture content.\\nThird',
    }),
  )
  const card = mountRich(() => <ContentPart item={item()} message={liveMessage} index={0} />)
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent === "+3")

  setItem(
    liveTool("write", {
      status: "completed",
      input: { path: "src/notes.md", content: "# Notes\nFixture content.\n" },
      content: [{ type: "text", text: "Wrote src/notes.md" }],
      metadata: { files: [writtenFile] },
    }),
  )

  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent === "+2")
  expect(counts(card.host)).toEqual({ additions: "+2", deletions: "-0" })
})

test("an edit card keeps its file expanded when the final diff names the file relatively", async () => {
  const input = { path: "/repo/src/math.ts", oldString: 'export const VERSION = "1.2.3"', newString: "y" }
  const [item, setItem] = createSignal<SessionMessageAssistantTool>(
    liveTool("edit", { status: "running", input, metadata: {} }),
  )
  const card = mountRich(() => (
    <ContentPart item={item()} message={liveMessage} index={0} directory="/repo" forceOpen />
  ))
  mounted.push(card)
  await waitFor(() => card.host.querySelector('[data-component="edit-content"]'))

  setItem(
    liveTool("edit", {
      status: "completed",
      input,
      content: [{ type: "text", text: "Edited src/math.ts" }],
      metadata: { files: [editedFile] },
    }),
  )

  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent === "+1")
  const content = await waitFor(() => card.host.querySelector('[data-component="edit-content"]'))
  expect(content.closest('[data-slot="accordion-item"]')?.hasAttribute("data-expanded")).toBe(true)
})

type StreamingTool = Extract<SessionMessageAssistantTool, { state: { status: "streaming" } }>

test("a streaming write card recounts when the tool input grows", async () => {
  const tool = liveTool("write", {
    status: "streaming",
    input: '{"path":"src/notes.md","content":"one',
  }) as StreamingTool
  const [store, setStore] = createStore<{ item: StreamingTool }>({ item: tool })
  const card = mountRich(() => <ContentPart item={store.item} message={liveMessage} index={0} />)
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent === "+1")

  setStore("item", "state", "input", (text) => text + "\\ntwo\\nthree")

  await waitFor(() => card.host.querySelector('[data-slot="diff-changes-additions"]')?.textContent === "+3")
})

test("the shell card titles itself with the model description, not the command", async () => {
  const card = mountTool("shell", {
    input: { command: "cd /work/tree && bun test", description: "Runs the unit tests" },
    partID: "shell-description",
    output: "ok",
  })
  mounted.push(card)

  const summary = await waitFor(() => card.host.querySelector('[data-slot="shell-submessage-value"]'))
  expect(summary.textContent).toBe("Runs the unit tests")
})

test("the shell card drops a leading cd prefix when the model gives no description", async () => {
  const card = mountTool("shell", {
    input: { command: "cd /work/tree && bun run check", workdir: "/work/tree" },
    partID: "shell-command",
    output: "ok",
  })
  mounted.push(card)

  const summary = await waitFor(() => card.host.querySelector('[data-slot="shell-submessage-value"]'))
  expect(summary.textContent).toBe("bun run check")
})

test("the shell card falls back to the description stored with the result", async () => {
  const card = mountTool("shell", {
    input: { command: "cd /work/tree && bun test" },
    metadata: { description: "Runs the unit tests" },
    partID: "shell-result-description",
    output: "ok",
  })
  mounted.push(card)

  const summary = await waitFor(() => card.host.querySelector('[data-slot="shell-submessage-value"]'))
  expect(summary.textContent).toBe("Runs the unit tests")
})

test("the shell card peels chained cd prefixes", async () => {
  const card = mountTool("shell", {
    input: { command: "cd /work/tree && cd packages/core && bun test" },
    partID: "shell-chained-cd",
    output: "ok",
  })
  mounted.push(card)

  const summary = await waitFor(() => card.host.querySelector('[data-slot="shell-submessage-value"]'))
  expect(summary.textContent).toBe("bun test")
})

test("the shell card keeps a title when the first line is only a cd prefix", async () => {
  const card = mountTool("shell", {
    input: { command: "cd /work/tree &&\nbun test" },
    partID: "shell-prefix-only",
    output: "ok",
  })
  mounted.push(card)

  const summary = await waitFor(() => card.host.querySelector('[data-slot="shell-submessage-value"]'))
  expect(summary.textContent).toBe("cd /work/tree &&")
})
