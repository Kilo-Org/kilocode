import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { AssistantMessage, ToolPart } from "@kilocode/sdk/v2"

const win = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window: win,
  document: win.document,
  customElements: win.customElements,
  navigator: win.navigator,
  Node: win.Node,
  Element: win.Element,
  HTMLElement: win.HTMLElement,
  HTMLAnchorElement: win.HTMLAnchorElement,
  HTMLButtonElement: win.HTMLButtonElement,
  HTMLDivElement: win.HTMLDivElement,
  HTMLPreElement: win.HTMLPreElement,
  SVGElement: win.SVGElement,
  MutationObserver: win.MutationObserver,
  ResizeObserver: win.ResizeObserver,
  CustomEvent: win.CustomEvent,
  Event: win.Event,
  MouseEvent: win.MouseEvent,
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  getComputedStyle: win.getComputedStyle.bind(win),
})

// Load browser modules only after the DOM globals exist.
const { createStore } = await import("solid-js/store")
const { render } = await import("solid-js/web")
const { Part } = await import("@kilocode/kilo-ui/message-part")
const { DataProvider } = await import("@opencode-ai/ui/context/data")
const { DialogProvider } = await import("@opencode-ai/ui/context/dialog")
const { FileComponentProvider } = await import("@kilocode/kilo-ui/context/file")
const { File } = await import("@kilocode/kilo-ui/file")
const { MarkedProvider, createMarkedParser } = await import("@kilocode/kilo-ui/context/marked")
const parser = createMarkedParser({})

const message: AssistantMessage = {
  id: "assistant",
  sessionID: "session",
  role: "assistant",
  parentID: "prompt",
  modelID: "fixture",
  providerID: "fixture",
  mode: "code",
  agent: "code",
  path: { cwd: "/project", root: "/project" },
  time: { created: 1, completed: 2 },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const files: string[] = []
const diffs: Array<{ file: string; patch?: string; additions: number; deletions: number }> = []
const data = { session: [], session_status: {}, session_diff: {}, message: {}, part: {} }
const disposals: Array<() => void> = []
const settle = async () => {
  await Promise.resolve()
  await win.happyDOM.waitUntilComplete()
}
function part(
  tool: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
  output = "",
): ToolPart {
  return {
    id: `part-${tool}`,
    sessionID: message.sessionID,
    messageID: message.id,
    type: "tool",
    tool,
    callID: `call-${tool}`,
    state: { status: "completed", input, metadata, output, title: tool, time: { start: 1, end: 2 } },
  }
}
function mount(initial: ToolPart) {
  const [value, update] = createStore(initial)
  const root = document.createElement("div")
  document.body.append(root)
  disposals.push(
    render(
      () => (
        <DataProvider
          data={data}
          directory="/project"
          onOpenFile={(file) => files.push(file)}
          onOpenDiff={(diff) => diffs.push(diff)}
          onSessionHref={(id) => `/session/${id}`}
        >
          <FileComponentProvider component={File}>
            <DialogProvider>
              <MarkedProvider nativeParser={async (text) => parser.parse(text)}>
                <Part part={value} message={message} defaultOpen={false} />
              </MarkedProvider>
            </DialogProvider>
          </FileComponentProvider>
        </DataProvider>
      ),
      root,
    ),
  )
  return { root, update }
}
function click(root: Element, selector: string) {
  const element = root.querySelector<HTMLElement>(selector)
  assert.ok(element, selector)
  element.click()
}

try {
  const read = mount(part("read", { filePath: "/project/read.txt" }))
  await settle()
  click(read.root, '[data-slot="basic-tool-tool-subtitle"].clickable')
  assert.deepEqual(files, ["/project/read.txt"])

  for (const tool of ["write", "edit"]) {
    const file = `/project/${tool}.txt`
    const before = tool === "write" ? "" : "before\n"
    const after = "after\n"
    const input =
      tool === "write" ? { filePath: file, content: after } : { filePath: file, oldString: before, newString: after }
    const patch =
      tool === "write"
        ? "--- /dev/null\n+++ b/write.txt\n@@ -0,0 +1 @@\n+after\n"
        : "--- a/edit.txt\n+++ b/edit.txt\n@@ -1 +1 @@\n-before\n+after\n"
    const view = mount(
      part(tool, input, { filediff: { file, patch, additions: 1, deletions: tool === "write" ? 0 : 1 } }),
    )
    await settle()
    click(view.root, '[data-slot="tool-trigger-actions"] button')
    const diff = diffs.at(-1)
    assert.equal(diff?.file, file)
    assert.match(diff?.patch ?? "", /\+after/)
    assert.equal(diff?.additions, 1)
    assert.equal(diff?.deletions, tool === "write" ? 0 : 1)
  }

  const task = mount(
    part("task", { description: "Inspect the fixture", subagent_type: "code" }, { sessionId: "child" }),
  )
  await settle()
  assert.equal(task.root.querySelector("a.subagent-link")?.getAttribute("href"), "/session/child")

  const glob = mount(part("glob", { pattern: "**/*.ts" }, {}, "/project/match.ts"))
  await settle()
  click(glob.root, '[data-slot="collapsible-trigger"]')
  await settle()
  const results = glob.root.querySelector('[data-component="tool-output"][data-variant="preview"]')
  assert.match(results?.textContent ?? "", /match\.ts/)

  const shell = mount(part("bash", { command: "printf fixture" }, {}, "shell result"))
  await settle()
  assert.doesNotMatch(shell.root.textContent ?? "", /shell result/)
  click(shell.root, '[data-slot="collapsible-trigger"]')
  await settle()
  assert.match(shell.root.textContent ?? "", /shell result/)

  const todo = part("todowrite", {
    todos: [{ id: "todo", content: "Verify the fixture", status: "pending", priority: "high" }],
  })
  const checklist = mount(todo)
  await settle()
  assert.equal(checklist.root.querySelector('[data-completed="completed"]'), null)
  checklist.update(
    part("todowrite", {
      todos: [{ id: "todo", content: "Verify the fixture", status: "completed", priority: "high" }],
    }),
  )
  await settle()
  assert.equal(checklist.root.querySelector('[data-completed="completed"]')?.textContent, "Verify the fixture")
} finally {
  for (const dispose of disposals) dispose()
  await win.happyDOM.cancelAsync()
  await win.happyDOM.close()
}
