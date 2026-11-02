import { afterEach, expect, test } from "bun:test"
import { BasicTool } from "../src/components/basic-tool"
import {
  ToolApprovalLine,
  ToolApprovalProvider,
  ToolApprovalVisibilityProvider,
  resolveToolApproval,
  toolApprovalFrom,
  type ToolApprovalDisplay,
} from "../src/components/tool-approval"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { agentApproval, manualApproval } from "./fixtures"
import { mount, settle, type Mounted } from "./harness"

let mounted: Mounted[] = []

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
  resetToolOpenState()
})

function translate(key: string, params?: Record<string, string | number | boolean>) {
  return params ? `${key}(${Object.values(params).join(",")})` : key
}

function render(display: ToolApprovalDisplay) {
  const value = mount(() => <ToolApprovalLine display={display} />)
  mounted.push(value)
  return value
}

test("reads a valid approval from metadata and rejects unknown sources", () => {
  expect(toolApprovalFrom({ approval: agentApproval })).toEqual(agentApproval)
  expect(toolApprovalFrom({ approval: { source: "unknown" } })).toBeUndefined()
  expect(toolApprovalFrom(undefined)).toBeUndefined()
  expect(toolApprovalFrom({})).toBeUndefined()
})

test("resolves an agent approval into decision, source, rule and workspace text", () => {
  const display = resolveToolApproval({ approval: agentApproval }, translate)

  expect(display?.decision).toBe("ui.approval.auto")
  expect(display?.source).toBe("ui.approval.source.agent(build)")
  expect(display?.rule).toBe("ui.approval.rule(edit,src/**)")
  expect(display?.outsideWorkspace).toBe("ui.approval.outsideWorkspace(math.ts)")
})

test("does not show the catch-all rule and omits the source for a manual approval", () => {
  const catchAll = resolveToolApproval(
    { approval: { source: "project", rule: { permission: "*", pattern: "*", action: "allow" } } },
    translate,
  )
  expect(catchAll?.rule).toBeUndefined()

  const manual = resolveToolApproval({ approval: manualApproval }, translate)
  expect(manual?.decision).toBe("ui.approval.manual")
  expect(manual?.source).toBeUndefined()
})

test("renders the approval line slots", () => {
  const display = resolveToolApproval({ approval: agentApproval }, translate)!
  const value = render(display)

  expect(value.host.querySelector('[data-slot="tool-approval-decision"]')?.textContent).toBe("ui.approval.auto")
  expect(value.host.querySelector('[data-slot="tool-approval-source"]')?.textContent).toBe(
    "ui.approval.source.agent(build)",
  )
  expect(value.host.querySelector('[data-slot="tool-approval-rule"]')?.textContent).toBe("ui.approval.rule(edit,src/**)")
  expect(value.host.querySelector('[data-slot="tool-approval-outside-workspace"]')?.textContent).toBe(
    "ui.approval.outsideWorkspace(math.ts)",
  )
  expect(value.host.querySelector('[data-slot="tool-approval-line"]')?.getAttribute("data-source")).toBe("agent")
})

test("a manual approval line shows only the decision", () => {
  const value = render(resolveToolApproval({ approval: manualApproval }, translate)!)

  expect(value.host.querySelector('[data-slot="tool-approval-decision"]')?.textContent).toBe("ui.approval.manual")
  expect(value.host.querySelector('[data-slot="tool-approval-source"]')).toBeNull()
  expect(value.host.querySelector('[data-slot="tool-approval-rule"]')).toBeNull()
})

test("BasicTool injects the approval line into its body and honors the visibility toggle", async () => {
  const display = resolveToolApproval({ approval: agentApproval }, translate)!
  const value = mount(() => (
    <ToolApprovalProvider value={() => display}>
      <ToolApprovalVisibilityProvider value={() => true}>
        <BasicTool icon="code-lines" status="completed" trigger={{ title: "Edit" }} forceOpen>
          <span data-testid="details">details body</span>
        </BasicTool>
      </ToolApprovalVisibilityProvider>
    </ToolApprovalProvider>
  ))
  mounted.push(value)
  await settle()

  expect(value.host.querySelector('[data-slot="tool-approval-line"]')).not.toBeNull()

  const hidden = mount(() => (
    <ToolApprovalProvider value={() => display}>
      <ToolApprovalVisibilityProvider value={() => false}>
        <BasicTool icon="code-lines" status="completed" trigger={{ title: "Edit" }} forceOpen>
          <span data-testid="details">details body</span>
        </BasicTool>
      </ToolApprovalVisibilityProvider>
    </ToolApprovalProvider>
  ))
  mounted.push(hidden)
  await settle()

  expect(hidden.host.querySelector('[data-slot="tool-approval-line"]')).toBeNull()
})