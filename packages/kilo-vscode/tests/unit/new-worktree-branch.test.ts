import { describe, expect, it } from "bun:test"
import { validBranch } from "../../webview-ui/agent-manager/new-worktree-branch"

describe("new worktree branch validation", () => {
  it("allows automatic naming when no explicit branch is supplied", () => {
    expect(validBranch(undefined)).toBe(true)
  })
  it.each([
    "Feature/My_fix.v2",
    "main",
    "@",
    "HEAD_v2",
    "feature/HEAD",
    "fix+login",
    "fix#123",
    "日本語",
    "foo/.hidden",
    "foo/bar.lock",
    "foo.lock/bar",
    "foo//bar",
    "/foo",
    "foo/",
    "foo.",
    "foo..bar",
    "foo@{bar",
    "@{-1}",
    "HEAD",
    "-foo",
    "",
    " ",
    " foo",
    "foo ",
    "foo bar",
    "foo\tbar",
    "foo\nbar",
    "foo\0bar",
    "foo\x7fbar",
    "foo~bar",
    "foo^bar",
    "foo:bar",
    "foo?bar",
    "foo*bar",
    "foo[bar",
    "foo\\bar",
    "foo]bar",
    "foo.locked",
    "foo./bar",
    "foo.LOCK",
    "foo/@",
    "foo/-bar",
  ])("matches literal Git branch validation for %j", (name) => {
    if (name.includes("\0")) {
      expect(validBranch(name)).toBe(false)
      return
    }
    const ref = Bun.spawnSync(["git", "check-ref-format", `refs/heads/${name}`])
    const branch = Bun.spawnSync(["git", "check-ref-format", "--branch", name])
    expect(validBranch(name)).toBe(ref.exitCode === 0 && branch.exitCode === 0)
  })
})
