import { afterEach, beforeEach, expect, test } from "bun:test"
import { BasicTool } from "../src/components/basic-tool"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { body, mount, trigger, waitFor, type Mounted } from "./harness"

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

function card(props: Partial<Parameters<typeof BasicTool>[0]> = {}) {
  const value = mount(() => (
    <BasicTool
      icon="code-lines"
      status="completed"
      trigger={{ title: "Edit", subtitle: "math.ts", args: ["2 lines"] }}
      {...props}
    >
      <span data-testid="details">details body</span>
    </BasicTool>
  ))
  mounted.push(value)
  return value
}

test("renders the trigger title, subtitle and args", () => {
  const value = card()

  expect(value.host.querySelector('[data-slot="basic-tool-tool-title"]')?.textContent).toBe("Edit")
  expect(value.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toBe("math.ts")
  expect(value.host.querySelector('[data-slot="basic-tool-tool-arg"]')?.textContent).toBe("2 lines")
})

test("starts collapsed and mounts the details body when the trigger is clicked", async () => {
  const value = card()
  const element = trigger(value.host)

  expect(element.getAttribute("aria-expanded")).toBe("false")
  expect(value.host.querySelector('[data-testid="details"]')).toBeNull()

  element.click()
  const details = await waitFor(() => value.host.querySelector('[data-testid="details"]'))

  expect(element.getAttribute("aria-expanded")).toBe("true")
  expect(details.textContent).toBe("details body")
  expect(body(value.host)).not.toBeNull()
})

test("forceOpen renders the details body without a click", () => {
  const value = card({ forceOpen: true })

  expect(trigger(value.host).getAttribute("aria-expanded")).toBe("true")
  expect(value.host.querySelector('[data-testid="details"]')?.textContent).toBe("details body")
})

test("hideDetails removes the body and the expand arrow", () => {
  const value = card({ hideDetails: true })

  expect(value.host.querySelector('[data-testid="details"]')).toBeNull()
  expect(value.host.querySelector('[data-slot="collapsible-arrow"]')).toBeNull()
  expect(value.host.querySelector('[data-component="tool-trigger"]')?.getAttribute("data-hide-details")).toBe("true")
})

test("defer does not construct the details body while collapsed", async () => {
  let built = 0
  const Body = () => {
    built++
    return <span data-testid="deferred">deferred body</span>
  }
  const value = mount(() => (
    <BasicTool
      defer
      icon="code-lines"
      status="completed"
      trigger={{ title: "Grep", subtitle: "src", args: ["3 files"] }}
    >
      <Body />
    </BasicTool>
  ))
  mounted.push(value)

  expect(built).toBe(0)
  expect(value.host.querySelector('[data-testid="deferred"]')).toBeNull()

  trigger(value.host).click()
  const details = await waitFor(() => value.host.querySelector('[data-testid="deferred"]'))

  expect(built).toBe(1)
  expect(details.textContent).toBe("deferred body")
})
