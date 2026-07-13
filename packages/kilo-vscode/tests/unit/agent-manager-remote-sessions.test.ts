import { expect, test } from "bun:test"
import { visible } from "../../webview-ui/agent-manager/remote-sessions"

test("reports a real session only while its chat surface is displayed", () => {
  expect(visible("ses_1", false)).toBe("ses_1")
  expect(visible("ses_1", true)).toBeNull()
})

test("does not report synthetic pending or cloud preview IDs", () => {
  expect(visible("pending:1", false)).toBeNull()
  expect(visible("cloud:1", false)).toBeNull()
})
