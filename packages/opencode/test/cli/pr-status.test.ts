// kilocode_change - new file
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EOL } from "node:os"
import { Effect } from "effect"

// Mock @/kilo-sessions/pr-link and the poller before importing the commands so
// the handlers read and write the session-recorded link from these stubs
// instead of spawning `gh` or touching real Storage.
const realPrLink = await import("@/kilo-sessions/pr-link")
const realPoller = await import("@/kilo-sessions/pr-link-poller")

type Record = {
  link: { platform: string; prUrl: string; prNumber: number }
  headRef?: string
  headSha?: string
  evidence: "pr_create" | "push" | "user"
}

let stored: Record | undefined

const read = mock(async (_sessionId: string) => stored)
const clear = mock(async (_sessionId: string) => {
  stored = undefined
})
const record = mock(async (_sessionId: string, evidence: Record) => {
  stored = evidence
  return evidence
})
const matches = mock(async (_link: unknown, _worktree: string) => true)
const refresh = mock(async () => undefined)

void mock.module("@/kilo-sessions/pr-link", () => ({
  ...realPrLink,
  readSessionPrLink: read,
  clearSessionLink: clear,
  recordSessionLink: record,
  linkMatchesWorktree: matches,
}))

void mock.module("@/kilo-sessions/pr-link-poller", () => ({
  ...realPoller,
  refreshPrLink: refresh,
}))

import { prLinkHandler, prStatusHandler, prUnlinkHandler } from "../../src/cli/cmd/pr"
import { InstanceRef } from "../../src/effect/instance-ref"
import type { InstanceContext } from "../../src/project/instance-context"

const writeSpy = spyOn(process.stderr, "write")

function lines() {
  return writeSpy.mock.calls
    .map((call) => String(call[0]))
    .join("")
    .split(EOL)
    .filter(Boolean)
}

function session(worktree: string) {
  const ctx = { directory: worktree, worktree, project: {} } as unknown as InstanceContext
  return Effect.provideService(InstanceRef, ctx)
}

function runStatus(id?: string) {
  return Effect.runPromise(prStatusHandler({ session: id }).pipe(session("/tmp/foo")))
}

function runLink(url: string, id?: string) {
  return Effect.runPromise(prLinkHandler({ url, session: id }).pipe(session("/tmp/foo")))
}

function runUnlink(id?: string) {
  return Effect.runPromise(prUnlinkHandler({ session: id }).pipe(session("/tmp/foo")))
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

describe("pr status", () => {
  beforeEach(() => {
    stored = undefined
    read.mockClear()
    clear.mockClear()
    record.mockClear()
    matches.mockClear()
    refresh.mockClear()
    writeSpy.mockClear()
    delete process.env.KILO_SESSION_ID
    delete process.env.KILO_SESSION
  })

  test("prints the session's stored link", async () => {
    stored = {
      link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/123", prNumber: 123 },
      evidence: "user",
    }
    await runStatus("ses_alpha")
    expect(read).toHaveBeenCalledWith("ses_alpha")
    expect(lines()).toEqual(["Linked PR #123 (github)", "https://github.com/owner/repo/pull/123"])
  })

  test("prints no PR linked when the session has none", async () => {
    await runStatus("ses_alpha")
    expect(lines()).toEqual(["no PR linked"])
    expect(refresh).not.toHaveBeenCalled()
  })

  test("fails without a session and never falls back to the worktree", async () => {
    const err = await runStatus().then(
      () => undefined,
      (err) => err,
    )
    expect(message(err)).toContain("No session specified")
    expect(read).not.toHaveBeenCalled()
  })

  test("resolves the session from KILO_SESSION_ID", async () => {
    process.env.KILO_SESSION_ID = "ses_env"
    stored = {
      link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/9", prNumber: 9 },
      evidence: "push",
    }
    await runStatus()
    expect(read).toHaveBeenCalledWith("ses_env")
    expect(lines()).toEqual(["Linked PR #9 (github)", "https://github.com/owner/repo/pull/9"])
  })

  test("refreshes only the session's own link", async () => {
    stored = {
      link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/1", prNumber: 1 },
      evidence: "push",
    }
    await runStatus("ses_alpha")
    expect(refresh).toHaveBeenCalledTimes(1)
    // Scoped to the requested session, so status makes one host call for this
    // session's PR instead of one per unrelated session's PR.
    expect(refresh).toHaveBeenCalledWith({ sessionId: "ses_alpha" })
    expect(read.mock.calls.every((call) => call[0] === "ses_alpha")).toBe(true)
  })
})

describe("pr link", () => {
  beforeEach(() => {
    stored = undefined
    record.mockClear()
    matches.mockClear()
    writeSpy.mockClear()
    delete process.env.KILO_SESSION_ID
    delete process.env.KILO_SESSION
  })

  test("records the link for the explicit session only", async () => {
    await runLink("https://github.com/owner/repo/pull/55", "ses_alpha")
    expect(matches).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0]?.[0]).toBe("ses_alpha")
    expect((record.mock.calls[0]?.[1] as Record).evidence).toBe("user")
    expect(lines()).toEqual(["Linked PR #55 (github)", "https://github.com/owner/repo/pull/55"])
  })

  test("fails without a session", async () => {
    const err = await runLink("https://github.com/owner/repo/pull/55").then(
      () => undefined,
      (err) => err,
    )
    expect(message(err)).toContain("No session specified")
    expect(record).not.toHaveBeenCalled()
  })

  test("refuses a link for another repository", async () => {
    matches.mockImplementationOnce(async () => false)
    const err = await runLink("https://github.com/other/repo/pull/55", "ses_alpha").then(
      () => undefined,
      (err) => err,
    )
    expect(message(err)).toContain("is not a pull request for this repository")
    expect(record).not.toHaveBeenCalled()
  })
})

describe("pr unlink", () => {
  beforeEach(() => {
    stored = {
      link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/8", prNumber: 8 },
      evidence: "user",
    }
    clear.mockClear()
    writeSpy.mockClear()
    delete process.env.KILO_SESSION_ID
    delete process.env.KILO_SESSION
  })

  test("clears only the explicit session", async () => {
    await runUnlink("ses_alpha")
    expect(clear).toHaveBeenCalledWith("ses_alpha")
    expect(stored).toBeUndefined()
    expect(lines()).toEqual(["PR link cleared"])
  })

  test("fails without a session", async () => {
    const err = await runUnlink().then(
      () => undefined,
      (err) => err,
    )
    expect(message(err)).toContain("No session specified")
    expect(clear).not.toHaveBeenCalled()
  })
})
