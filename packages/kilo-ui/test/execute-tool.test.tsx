import { afterEach, beforeEach, expect, test } from "bun:test"
import { executeArgs, executeCalls, executeRaw } from "../src/components/execute-data"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { mountTool, trigger, waitFor, type Mounted } from "./harness"

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

const subtitle = (card: Mounted) =>
  card.host.querySelector('[data-slot="execute-ticker-line"]:not([data-old])')?.textContent

test("calls keep their exact tool path, status and plain arguments in the order sent", () => {
  const calls = executeCalls({
    toolCalls: [
      { tool: "github.get_issue", status: "completed", input: { owner: "kilo-org", repo: "kilocode", number: 7 } },
      { tool: "fetch", status: "queued" },
      { bad: 1 },
    ],
  })
  expect(calls).toEqual([
    { tool: "github.get_issue", status: "completed", input: { owner: "kilo-org", repo: "kilocode", number: 7 } },
    { tool: "fetch", status: "queued", input: {} },
  ])
  expect(executeArgs({ owner: "kilo-org", nested: { a: 1 }, open: true, query: "a\n b" })).toBe(
    "owner=kilo-org, open=true, query=a b",
  )
  expect(executeRaw('"{\\"a\\":1}"')).toEqual({ text: '{\n  "a": 1\n}', json: true })
  expect(executeRaw("plain text")).toEqual({ text: "plain text", json: false })
})

test("a running card names the running call, or says it is working after a pause between calls", async () => {
  const card = mountTool("execute", {
    status: "running",
    metadata: {
      toolCalls: [
        { tool: "read", status: "completed", input: { path: "a.ts" } },
        { tool: "fetch", status: "running", input: { url: "https://kilo.ai/docs", method: "GET" } },
      ],
    },
  })
  mounted.push(card)
  expect(subtitle(card)).toBe("fetch · 2 calls")
  const segments = [...card.host.querySelectorAll('[data-slot="execute-segment"]')]
  expect(segments.map((item) => item.getAttribute("data-status"))).toEqual(["completed", "running"])

  const idle = mountTool("execute", {
    status: "running",
    metadata: { toolCalls: [{ tool: "read", status: "completed", input: { path: "a.ts" } }] },
    forceOpen: true,
  })
  mounted.push(idle)
  expect(subtitle(idle)).toBe("read")
  await waitFor(() => subtitle(idle) === "Working", 1500)
  const args = await waitFor(() => idle.host.querySelector('[data-slot="execute-call-args"]'))
  expect(args.textContent).toBe(" path=a.ts")
})

test("a finished card summarizes the calls and keeps the script behind one click", async () => {
  const card = mountTool("execute", {
    input: { code: "return 1" },
    metadata: {
      toolCalls: [
        { tool: "fetch", status: "completed", input: { url: "https://a.test/1" } },
        { tool: "fetch", status: "error", input: { url: "https://a.test/2" } },
        { tool: "github.get_issue", status: "completed", input: { number: 1 } },
      ],
    },
    output: "1",
    forceOpen: true,
  })
  mounted.push(card)

  expect(subtitle(card)).toBe("3 calls · fetch, github.get_issue · 1 failed")
  // The body is deferred like every other tool card, so it builds a moment after the card opens.
  await waitFor(() => card.host.querySelector('[data-slot="execute-call"]'))
  // A failed call keeps the ring open, so the finish is never shown as clean.
  expect(card.host.querySelector('[data-slot="execute-check"]')).toBeNull()
  expect([...card.host.querySelectorAll('[data-slot="execute-call-name"]')].map((item) => item.textContent)).toEqual([
    "fetch",
    "fetch",
    "github.get_issue",
  ])
  expect(card.host.querySelector('[data-slot="execute-details"]')).toBeNull()
  card.host.querySelector<HTMLElement>('[data-slot="execute-script-toggle"]')?.click()
  expect(card.host.querySelector('[data-slot="execute-details"]')).not.toBeNull()
})

test("a failed script shows its own error once, apart from the calls", async () => {
  const card = mountTool("execute", {
    input: { code: "throw new Error('boom')" },
    metadata: {
      error: true,
      toolCalls: [
        { tool: "browser.tabs.list", status: "completed" },
        { tool: "browser.tabs.open", status: "error", input: { url: "file:///x" } },
      ],
    },
    output: "Error: file:// URLs are not browser URLs.\nUse browser.preview instead.",
    forceOpen: true,
  })
  mounted.push(card)

  expect(subtitle(card)).toBe("Script failed")
  await waitFor(() => card.host.querySelector('[data-slot="execute-error"]'))
  expect(card.host.querySelector('[data-slot="execute-error"]')?.textContent).toBe("file:// URLs are not browser URLs.")
  expect(card.host.querySelector('[data-slot="execute-segment"][data-status="error"]')).not.toBeNull()
})

test("an unknown status stays visible as a neutral row, and long runs fold the earliest calls", async () => {
  const card = mountTool("execute", {
    metadata: {
      toolCalls: [
        { tool: "fetch", status: "queued", input: {} },
        ...Array.from({ length: 8 }, (_, index) => ({
          tool: "fetch",
          status: "completed",
          input: { url: `https://a.test/${index}` },
        })),
      ],
    },
    forceOpen: true,
  })
  mounted.push(card)

  await waitFor(() => card.host.querySelector('[data-slot="execute-call"]'))
  expect(card.host.querySelectorAll('[data-slot="execute-call"]')).toHaveLength(6)
  expect(card.host.querySelector('[data-slot="execute-more"]')?.textContent).toBe("3 earlier calls")
  card.host.querySelector<HTMLElement>('[data-slot="execute-more"]')?.click()
  expect(
    card.host.querySelector('[data-slot="execute-call"][data-status="queued"] [data-slot="execute-call-dot"]'),
  ).not.toBeNull()
})

test("a display layout change clears remembered open states so the new default wins", async () => {
  const props = {
    metadata: { toolCalls: [{ tool: "fetch", status: "completed", input: { url: "https://a.test" } }] },
    partID: "execute-remembered",
  }
  const expanded = (card: Mounted) => trigger(card.host).getAttribute("aria-expanded")

  // A click stores the open state for this call, and a remount restores it over the collapsed default.
  const first = mountTool("execute", props)
  expect(expanded(first)).toBe("false")
  trigger(first.host).click()
  expect(expanded(first)).toBe("true")
  first.dispose()

  const kept = mountTool("execute", props)
  expect(expanded(kept)).toBe("true")
  kept.dispose()

  resetToolOpenState()

  const reset = mountTool("execute", props)
  mounted.push(reset)
  expect(expanded(reset)).toBe("false")
})
