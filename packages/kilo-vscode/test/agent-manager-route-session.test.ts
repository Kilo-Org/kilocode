import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { routeSession } from "../src/agent-manager/route-session"

describe("routeSession", () => {
  let root: string
  let worktree: string
  let directory: string
  let client: {
    session: { get: ReturnType<typeof mock>; move: ReturnType<typeof mock>; active: ReturnType<typeof mock> }
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-route-"))
    worktree = path.join(root, ".kilo", "worktrees", "one")
    fs.mkdirSync(worktree, { recursive: true })
    directory = worktree
    client = {
      session: {
        get: mock(async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory } })),
        move: mock(async ({ directory: next }: { directory: string }) => {
          directory = next
        }),
        active: mock(async () => ({})),
      },
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("moves a worktree session opened locally to the project root", async () => {
    await routeSession(client as never, "ses_1", root, () => undefined)

    expect(client.session.move).toHaveBeenCalledWith({ sessionID: "ses_1", directory: root })
    expect(directory).toBe(root)
  })

  it("leaves a session that already runs in the project root alone", async () => {
    directory = root

    await routeSession(client as never, "ses_1", `${root}/`, () => undefined)

    expect(client.session.move).not.toHaveBeenCalled()
  })

  it("does not reject when the server cannot read or move the session", async () => {
    const logs: unknown[][] = []
    client.session.get.mockRejectedValueOnce(new Error("offline"))
    await routeSession(client as never, "ses_1", root, (...args) => logs.push(args))
    client.session.move.mockRejectedValueOnce(new Error("move failed"))
    await routeSession(client as never, "ses_1", root, (...args) => logs.push(args))

    expect(logs).toHaveLength(2)
  })
})
