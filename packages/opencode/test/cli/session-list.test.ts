// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { SessionID } from "@/session/schema"
import type { SessionStatus } from "@/session/status"
import { Session } from "@/session/session"
import {
  formatGlobalSessionJSON,
  formatGlobalSessionTable,
  formatSessionJSON,
  formatSessionTable,
} from "@/cli/cmd/session"

const id = (value: string) => SessionID.make(value)
const iso = new Date(1_700_000_000_000).toISOString()

const session = (value: string, title: string) =>
  ({ id: id(value), title, time: { created: 1, updated: 1_700_000_000_000 } }) as unknown as Session.Info

const globalSession = (value: string, title: string) =>
  ({
    ...session(value, title),
    project: { id: "prj_1", name: "proj", worktree: "/tmp/proj" },
  }) as unknown as Session.GlobalInfo

const scheduled: Record<string, SessionStatus.Info> = {
  [String(id("ses_sleep"))]: { type: "scheduled", scheduledAt: iso },
}

describe("formatSessionTable", () => {
  test("renders `scheduled <ISO>` for a session asleep on a wakeup", () => {
    const table = formatSessionTable([session("ses_sleep", "Sleepy")], scheduled)
    expect(table).toContain(`scheduled ${iso}`)
  })

  test("renders `idle` for a session with no status", () => {
    const table = formatSessionTable([session("ses_free", "Free")], {})
    expect(table).toContain("idle")
    expect(table).not.toContain("scheduled")
  })
})

describe("formatSessionJSON", () => {
  test("carries the scheduled payload with scheduledAt", () => {
    const parsed = JSON.parse(formatSessionJSON([session("ses_sleep", "Sleepy")], scheduled)) as Array<{
      status: SessionStatus.Info
    }>
    expect(parsed.at(0)?.status).toEqual({ type: "scheduled", scheduledAt: iso })
  })

  test("an idle session carries no scheduledAt", () => {
    const parsed = JSON.parse(
      formatSessionJSON([session("ses_free", "Free")], {
        [String(id("ses_free"))]: { type: "idle" },
      }),
    ) as Array<{ status: SessionStatus.Info }>
    expect(parsed.at(0)?.status).toEqual({ type: "idle" })
    expect(JSON.stringify(parsed)).not.toContain("scheduledAt")
  })
})

describe("global formatters", () => {
  test("keep the Project column beside the new Status column", () => {
    const table = formatGlobalSessionTable([globalSession("ses_sleep", "Sleepy")], scheduled)
    expect(table).toContain(`scheduled ${iso}`)
    expect(table).toContain("proj")
  })

  test("carry the scheduled status in JSON", () => {
    const parsed = JSON.parse(
      formatGlobalSessionJSON([globalSession("ses_sleep", "Sleepy")], scheduled),
    ) as Array<{ status: SessionStatus.Info }>
    expect(parsed.at(0)?.status).toEqual({ type: "scheduled", scheduledAt: iso })
  })
})
