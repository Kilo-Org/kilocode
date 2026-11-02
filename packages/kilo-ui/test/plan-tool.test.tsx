import { afterEach, beforeEach, expect, test } from "bun:test"
import { ToolRegistry } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { PlanTool } from "../src/components/tools/plan"
import { mountTool, waitFor, type Mounted } from "./harness"

ToolRegistry.register({ name: "plan_exit", render: PlanTool })

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

test("plan card shows the ready label, badge and relative plan path", async () => {
  const card = mountTool("plan_exit", {
    input: {},
    metadata: { plan: "/repo/.kilo/plans/change.md" },
    directory: "/repo",
    partID: "plan-card",
    actions: { openFile: () => {} },
  })
  mounted.push(card)
  const link = await waitFor(() => card.host.querySelector<HTMLAnchorElement>('[data-slot="plan-tool-open"]'))

  expect(card.host.querySelector('[data-component="plan-tool"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="plan-tool-label"]')?.textContent).toBe("Plan ready")
  expect(card.host.querySelector('[data-slot="plan-tool-badge"]')?.textContent).toBe("Plan")
  expect(link.textContent).toBe(".kilo/plans/change.md")
  expect(link.getAttribute("href")).toBe("#")
})

test("clicking the plan path opens the plan file", async () => {
  const calls: string[] = []
  const card = mountTool("plan_exit", {
    input: {},
    metadata: { plan: "/repo/.kilo/plans/change.md" },
    directory: "/repo",
    partID: "plan-open",
    actions: { openFile: (path) => calls.push(path) },
  })
  mounted.push(card)
  const link = await waitFor(() => card.host.querySelector<HTMLElement>('[data-slot="plan-tool-open"]'))
  link.click()

  expect(calls).toEqual(["/repo/.kilo/plans/change.md"])
})

test("plan card falls back to the tool input path", async () => {
  const calls: string[] = []
  const card = mountTool("plan_exit", {
    input: { path: "/repo/docs/plan.md" },
    directory: "/repo",
    partID: "plan-input",
    actions: { openFile: (path) => calls.push(path) },
  })
  mounted.push(card)
  const link = await waitFor(() => card.host.querySelector<HTMLElement>('[data-slot="plan-tool-open"]'))
  link.click()

  expect(link.textContent).toBe("docs/plan.md")
  expect(calls).toEqual(["/repo/docs/plan.md"])
})

test("plan card renders the tool output as the plan body", async () => {
  const card = mountTool("plan_exit", {
    input: {},
    metadata: { plan: "/repo/.kilo/plans/change.md" },
    output: "Plan is ready at .kilo/plans/change.md. Ending planning turn.",
    directory: "/repo",
    partID: "plan-output",
  })
  mounted.push(card)
  const body = await waitFor(() => card.host.querySelector('[data-slot="plan-tool-body"]'))

  expect(body.textContent).toContain("Plan is ready at")
})

test("plan card shows a plain path without an open action", async () => {
  const card = mountTool("plan_exit", {
    input: {},
    metadata: { plan: "/repo/.kilo/plans/change.md" },
    directory: "/repo",
    partID: "plan-no-action",
  })
  mounted.push(card)
  const path = await waitFor(() => card.host.querySelector('[data-slot="plan-tool-path"]'))

  expect(path.textContent).toBe(".kilo/plans/change.md")
  expect(card.host.querySelector('[data-slot="plan-tool-open"]')).toBeNull()
})