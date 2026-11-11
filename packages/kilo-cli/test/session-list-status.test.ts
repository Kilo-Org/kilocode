import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { formatList } from "../src/commands/session-list"

const session = (id: string, title = "A session") =>
  ({ id, title, time: { created: 1, updated: 1 } }) as SessionInfo

test("a session with a future wakeup shows the scheduled status field", () => {
  const due = Date.parse("2026-11-11T09:00:00.000Z")
  const output = formatList([session("ses_a"), session("ses_b")], new Map([["ses_b", due]]))
  const rows = output.split("\n")
  expect(rows[0]).not.toContain("scheduled")
  expect(rows[1]).toContain("scheduled 2026-11-11T09:00:00.000Z")
})

test("the list stays three fields wide when nothing is scheduled", () => {
  const output = formatList([session("ses_a")], new Map())
  expect(output).toBe(`ses_a\tA session\t${new Date(1).toLocaleString()}`)
})
