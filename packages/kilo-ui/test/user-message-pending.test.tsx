import { afterEach, expect, test } from "bun:test"
import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay } from "../src/components/message-part"
import { mountRich, type Mounted } from "./harness"

let mounted: Mounted[] = []

afterEach(() => {
  for (const view of mounted) view.dispose()
  mounted = []
})

const message = { id: "msg_1", type: "user", text: "Check the tests", time: { created: 1 } } as SessionMessageUser

test("a pending message shows its status and controls instead of fork and copy", () => {
  const clicks: string[] = []
  const view = mountRich(() => (
    <UserMessageDisplay
      message={message}
      onFork={() => clicks.push("fork")}
      pending={{
        status: "Queued",
        actions: [
          { key: "steer", icon: "arrow-up", label: "Steer", onClick: () => clicks.push("steer") },
          { key: "delete", icon: "close-small", label: "Delete", onClick: () => clicks.push("delete"), disabled: true },
        ],
      }}
    />
  ))
  mounted.push(view)

  expect(view.host.querySelector('[data-slot="user-message-text"]')?.hasAttribute("data-queued")).toBe(true)
  expect(view.host.querySelector('[data-slot="user-message-queued-indicator"]')?.textContent).toContain("Queued")
  expect(view.host.querySelector('[data-slot="user-message-clamp"]')?.textContent).toBe("Check the tests")
  expect(view.host.querySelector('[aria-label="Fork to new session"]')).toBeNull()
  expect(view.host.querySelector('[aria-label="Copy message"]')).toBeNull()

  const steer = view.host.querySelector<HTMLButtonElement>('[data-action="steer"]')!
  const remove = view.host.querySelector<HTMLButtonElement>('[data-action="delete"]')!
  steer.click()
  expect(clicks).toEqual(["steer"])
  expect(remove.disabled).toBe(true)
})

test("a delivered message keeps its fork and copy actions", () => {
  const view = mountRich(() => <UserMessageDisplay message={message} onFork={() => undefined} />)
  mounted.push(view)

  expect(view.host.querySelector('[data-slot="user-message-queued-indicator"]')).toBeNull()
  expect(view.host.querySelector('[data-slot="user-message-text"]')?.hasAttribute("data-queued")).toBe(false)
  expect(view.host.querySelector('[data-slot="user-message-clamp"]')).toBeNull()
  expect(view.host.querySelector('[aria-label="Fork to new session"]')).not.toBeNull()
  expect(view.host.querySelector('[aria-label="Copy message"]')).not.toBeNull()
})

test("a bubble header renders inside the bubble above the text", () => {
  const view = mountRich(() => (
    <UserMessageDisplay message={message} bubbleHeader={<span class="notice">Sent by Kilo</span>} />
  ))
  mounted.push(view)

  const text = view.host.querySelector('[data-slot="user-message-text"]')
  expect(text?.firstElementChild?.textContent).toBe("Sent by Kilo")
  expect(text?.textContent).toContain("Check the tests")
})
