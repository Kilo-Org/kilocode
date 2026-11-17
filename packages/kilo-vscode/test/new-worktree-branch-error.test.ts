import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const dialog = readFileSync(join(import.meta.dir, "../webview-ui/agent-manager/NewWorktreeDialog.tsx"), "utf8")

describe("New Worktree branch blocker", () => {
  it("stores the branch error, gates Create on it, and keeps the warning out of the scrolling form", () => {
    expect(dialog).toContain("setBranchError(ev.errorCode)")
    expect(dialog).toContain("if (branchError()) return false")
    expect(dialog).toContain("when={branchError()}")
    // A blocked project must not be cached as healthy.
    expect(dialog).toContain("if (ev.projectId && !ev.errorCode) cacheBranches")

    // The warning sits between the scroll container and the pinned footer, so a long draft cannot hide it.
    expect(dialog).toMatch(
      /<\/div>\s*<Show when=\{branchError\(\)\}>[\s\S]*?<\/Show>\s*<div class="am-nv-dialog-footer">/,
    )
  })
})
