import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { visible } from "../../webview-ui/agent-manager/remote-sessions"

const APP = path.resolve(import.meta.dir, "../../webview-ui/agent-manager/AgentManagerApp.tsx")

function flat(source: string) {
  return source.replace(/\s+/g, " ")
}

test("reports a real session only while its chat surface is displayed", () => {
  expect(visible("ses_1", false)).toBe("ses_1")
  expect(visible("ses_1", true)).toBeNull()
})

test("does not report synthetic pending or cloud preview IDs", () => {
  expect(visible("pending:1", false)).toBeNull()
  expect(visible("cloud:1", false)).toBeNull()
})

test("blocks visible presence while setup or an empty pane covers chat", () => {
  const source = flat(fs.readFileSync(APP, "utf-8"))
  expect(source).toContain(
    "visible( session.currentSessionID(), !!terms.activeId() || reviewActive() || history() || !!overlay() || contextEmpty(), )",
  )
  expect(source).toContain("<Show when={overlay()}>")
})
