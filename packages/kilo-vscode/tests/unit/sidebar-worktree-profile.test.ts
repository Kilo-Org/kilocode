import { describe, expect, it } from "bun:test"
import { handleSidebarWorktreeMessage } from "../../src/kilo-provider/sidebar-worktree"

function ctx(calls: Array<boolean | undefined>) {
  const done = () => Promise.resolve()
  return {
    post: () => {},
    openAgentManager: done,
    openAdvancedWorktree: done,
    openChanges: done,
    openProfile: (login?: boolean) => {
      calls.push(login)
      return Promise.resolve()
    },
  }
}

describe("openProfilePanel", () => {
  it("opens the Profile panel without starting a login", async () => {
    const calls: Array<boolean | undefined> = []
    expect(await handleSidebarWorktreeMessage({ type: "openProfilePanel" }, ctx(calls))).toBe(true)
    expect(calls).toEqual([undefined])
  })

  it("asks the Profile panel to start the login for the signed-out card", async () => {
    const calls: Array<boolean | undefined> = []
    expect(await handleSidebarWorktreeMessage({ type: "openProfilePanel", login: true }, ctx(calls))).toBe(true)
    expect(calls).toEqual([true])
  })
})
