import { afterEach, beforeEach, expect, test } from "bun:test"
import type { ToolProps } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { ExecuteTool } from "../src/components/tools/execute"
import { MarkedProvider } from "../src/context/marked"
import { mount, waitFor, type Mounted } from "./harness"

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

const defaults: ToolProps = {
  input: {},
  metadata: {},
  tool: "execute",
  partID: "execute-card",
  output: "",
  status: "completed",
  attachments: [],
}

function mountExecute(props: Partial<ToolProps> = {}) {
  const merged = { ...defaults, ...props }
  const card = mount(() => (
    <MarkedProvider>
      <ExecuteTool {...merged} />
    </MarkedProvider>
  ))
  mounted.push(card)
  return card
}

function calls(host: ParentNode) {
  return [...host.querySelectorAll<HTMLElement>('[data-slot="execute-tool-call"]')].map((row) => ({
    name: row.querySelector('[data-slot="execute-tool-call-name"]')?.textContent,
    server: row.querySelector('[data-slot="execute-tool-call-server"]')?.textContent,
    status: row.getAttribute("data-status"),
    label: row.querySelector('[data-slot="execute-tool-call-status"]')?.textContent,
    args: row.querySelector('[data-slot="execute-tool-call-arguments"]')?.textContent,
  }))
}

test("renders one row per nested call with its tool, server and status", async () => {
  const card = mountExecute({
    metadata: {
      toolCalls: [
        { tool: "demo.status", status: "completed", input: { query: "health" } },
        { tool: "demo.search", status: "error", input: { query: "broken" } },
        { tool: "echo", status: "running", input: { value: 3 } },
      ],
    },
    forceOpen: true,
  })
  await waitFor(() => card.host.querySelector('[data-component="execute-tool"]'))

  expect(card.host.querySelector('[data-component="execute-tool"]')).not.toBeNull()
  expect(calls(card.host)).toEqual([
    { name: "status", server: "demo", status: "completed", label: "Completed", args: "query=health" },
    { name: "search", server: "demo", status: "error", label: "Error", args: "query=broken" },
    { name: "echo", server: undefined, status: "running", label: "Running", args: "value=3" },
  ])
  expect(card.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toBe("3 calls")
})

test("shows generated files and the final text", async () => {
  const card = mountExecute({
    metadata: { toolCalls: [{ tool: "chart.render", status: "completed" }] },
    attachments: [
      { type: "file", uri: "data:text/plain;base64,Zml4dHVyZQ==", mime: "text/plain", name: "report.txt" },
      { type: "file", uri: "data:image/png;base64,Zml4dHVyZQ==", mime: "image/png" },
    ],
    output: "Generated one report.",
    forceOpen: true,
  })
  await waitFor(() => card.host.querySelector('[data-slot="execute-tool-result"]'))

  const files = [...card.host.querySelectorAll('[data-slot="execute-tool-file"]')]
  expect(files.map((file) => file.querySelector('[data-slot="execute-tool-file-name"]')?.textContent)).toEqual([
    "report.txt",
    "image/png",
  ])
  expect(files[0]?.querySelector('[data-slot="execute-tool-file-mime"]')?.textContent).toBe("text/plain")
  expect(files[1]?.querySelector('[data-slot="execute-tool-file-mime"]')).toBeNull()
  expect(card.host.querySelector('[data-slot="execute-tool-result"]')?.textContent).toContain("Generated one report.")
})

test("keeps the raw script collapsed after the result", async () => {
  const card = mountExecute({
    input: { code: "const health = await tools.demo.status({ query: 'health' })\nreturn health" },
    metadata: { toolCalls: [{ tool: "demo.status", status: "completed" }] },
    output: "healthy",
    forceOpen: true,
  })
  await waitFor(() => card.host.querySelector('[data-slot="execute-tool-result"]'))

  const script = card.host.querySelector<HTMLDetailsElement>('[data-slot="execute-tool-script"]')
  const result = card.host.querySelector('[data-slot="execute-tool-result"]')
  expect(script).not.toBeNull()
  expect(script?.open).toBe(false)
  expect(script?.querySelector("summary")?.textContent).toBe("View code")
  expect(script?.querySelector("code")?.textContent).toContain("tools.demo.status")
  expect(result?.compareDocumentPosition(script!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test("marks a failed script and its failed call", async () => {
  const card = mountExecute({
    metadata: {
      error: true,
      toolCalls: [{ tool: "demo.search", status: "error", input: { query: "x" } }],
    },
    forceOpen: true,
  })
  await waitFor(() => card.host.querySelector('[data-component="execute-tool"]'))

  expect(card.host.querySelector('[data-component="execute-tool"]')?.getAttribute("data-state")).toBe("error")
  expect(card.host.querySelector('[data-slot="execute-tool-error"]')?.textContent).toBe("Error")
  expect(calls(card.host)[0]?.status).toBe("error")
})

test("renders an empty card when the script made no nested calls", async () => {
  const card = mountExecute({ forceOpen: true })
  await waitFor(() => card.host.querySelector('[data-component="execute-tool"]'))

  expect(card.host.querySelector('[data-slot="execute-tool-calls"]')).toBeNull()
  expect(card.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')).toBeNull()
  expect(card.host.querySelector('[data-component="execute-tool"]')).not.toBeNull()
})

test("keeps the body unbuilt while the card is collapsed", () => {
  const card = mountExecute({
    metadata: { toolCalls: [{ tool: "demo.status", status: "completed" }] },
    output: "healthy",
  })

  expect(card.host.querySelector('[data-component="tool-trigger"]')).not.toBeNull()
  expect(card.host.querySelector('[data-component="execute-tool"]')).toBeNull()
})
