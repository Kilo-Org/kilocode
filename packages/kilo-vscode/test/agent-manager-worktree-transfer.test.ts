import { describe, expect, test } from "bun:test"
import {
  clearWorktreeTransfer,
  reduceWorktreeTransfer,
  type WorktreeTransferState,
} from "../webview-ui/src/v2/worktree-transfer-message"

const idle: WorktreeTransferState = { transferring: false, detail: "" }
const options = {
  activeProject: "prj-a",
  progress: (status: string) => `progress:${status}`,
  failed: "failed",
}

describe("worktree transfer messages", () => {
  test("a project switch drops the branch and any running transfer", () => {
    expect(clearWorktreeTransfer()).toEqual({ branch: undefined, transferring: false, detail: "" })
  })

  test("ignores a branch answer from another project", () => {
    expect(
      reduceWorktreeTransfer(
        { ...idle, branch: "main" },
        { type: "agentManager.repoInfo", branch: "other", projectId: "prj-b" },
        options,
      ),
    ).toBeUndefined()
  })

  test("takes a branch answer for the active project", () => {
    expect(
      reduceWorktreeTransfer(
        idle,
        { type: "agentManager.repoInfo", branch: "feature", projectId: "prj-a" },
        options,
      ),
    ).toEqual({ state: { branch: "feature", transferring: false, detail: "" } })
  })

  test("accepts a branch answer without a project id, as the sidebar sends", () => {
    expect(
      reduceWorktreeTransfer(idle, { type: "agentManager.repoInfo", branch: "main" }, { ...options, activeProject: undefined }),
    ).toEqual({ state: { branch: "main", transferring: false, detail: "" } })
  })

  test("clears the transfer and asks for the branch after done", () => {
    expect(
      reduceWorktreeTransfer(
        { branch: "main", transferring: true, detail: "Transferring changes..." },
        { type: "continueInWorktreeProgress", status: "done" },
        options,
      ),
    ).toEqual({ state: { branch: "main", transferring: false, detail: "" }, refresh: true })
  })

  test("resets the transfer on error and reports the message", () => {
    expect(
      reduceWorktreeTransfer(
        { branch: "main", transferring: true, detail: "Creating worktree..." },
        { type: "continueInWorktreeProgress", status: "error", error: "boom" },
        options,
      ),
    ).toEqual({ state: { branch: "main", transferring: false, detail: "" }, refresh: true, toast: "boom" })
  })

  test("falls back to the shared error title", () => {
    expect(
      reduceWorktreeTransfer(
        { branch: "main", transferring: true, detail: "" },
        { type: "continueInWorktreeProgress", status: "error" },
        options,
      )?.toast,
    ).toBe("failed")
  })

  test("shows the localized progress step", () => {
    expect(
      reduceWorktreeTransfer(
        { branch: "main", transferring: true, detail: "" },
        { type: "continueInWorktreeProgress", status: "capturing" },
        options,
      ),
    ).toEqual({ state: { branch: "main", transferring: true, detail: "progress:capturing" } })
  })

  test("ignores other host messages", () => {
    expect(reduceWorktreeTransfer(idle, { type: "agentManager.state" }, options)).toBeUndefined()
  })
})
