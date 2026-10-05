import { describe, expect, it } from "bun:test"
import { folderOf } from "../../webview-ui/src/utils/workspace-folder"
import { sessionToWebview } from "../../src/kilo-provider-utils"

const folders = [
  { path: "/ws/alpha", name: "alpha" },
  { path: "/ws/beta", name: "beta" },
  { path: "/ws/beta/pkg", name: "pkg" },
]

describe("folderOf", () => {
  it("names the folder containing a session directory", () => {
    expect(folderOf("/ws/alpha", folders)?.name).toBe("alpha")
    expect(folderOf("/ws/alpha/.kilo/worktrees/x", folders)?.name).toBe("alpha")
  })

  it("prefers the deepest folder when folders nest", () => {
    expect(folderOf("/ws/beta/pkg/src", folders)?.name).toBe("pkg")
    expect(folderOf("/ws/beta/src", folders)?.name).toBe("beta")
  })

  it("does not match a sibling that shares a name prefix", () => {
    expect(folderOf("/ws/alpha-two", folders)).toBeUndefined()
  })

  it("compares Windows paths regardless of case and separators", () => {
    const win = [{ path: "C:\\Repos\\Alpha", name: "Alpha" }]
    expect(folderOf("c:/repos/alpha/src", win)?.name).toBe("Alpha")
  })

  it("is undefined without a directory", () => {
    expect(folderOf(undefined, folders)).toBeUndefined()
  })
})

describe("sessionToWebview directory", () => {
  const base = { id: "ses_1", title: "t", time: { created: 0, updated: 0 } }

  it("passes the session directory through", () => {
    expect(sessionToWebview({ ...base, directory: "/ws/beta" }).directory).toBe("/ws/beta")
  })

  it("omits the key when the directory is unknown", () => {
    expect("directory" in sessionToWebview(base)).toBe(false)
  })
})
