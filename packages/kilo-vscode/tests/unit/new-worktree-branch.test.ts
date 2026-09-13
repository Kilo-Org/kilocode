import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
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

  it("rejects invalid input before starting, submitting, clearing drafts, or closing", () => {
    const src = readFileSync(join(__dirname, "../../webview-ui/agent-manager/NewWorktreeDialog.tsx"), "utf8")
    const submit = src.slice(src.indexOf("const handleSubmit ="), src.indexOf("const handleKeyDown ="))
    const messages: unknown[] = []
    const run = new Function(
      "canSubmit",
      "showAdvanced",
      "branchName",
      "validBranch",
      "showToast",
      "t",
      submit.slice(submit.indexOf("{") + 1, submit.lastIndexOf("}")),
    )
    // Execute the real handler. Any submission side effect would access an unbound dependency and fail.
    run(
      () => true,
      () => true,
      () => "../escape",
      validBranch,
      (msg: unknown) => messages.push(msg),
      (key: string) => key,
    )
    expect(messages).toHaveLength(1)
    const guard = submit.indexOf("if (!validBranch(customBranch))")
    expect(guard).toBeGreaterThan(-1)
    expect(submit.slice(guard, submit.indexOf("setStarting(true)"))).toContain("return")
    for (const effect of [
      "setStarting(true)",
      "props.onCreate",
      "vscode.postMessage",
      'persistPrompt("")',
      "persistImages([])",
      "props.onClose()",
    ])
      expect(submit.indexOf(effect)).toBeGreaterThan(guard)
    expect(submit).toContain("const customBranch = advanced ? branchName() || undefined : undefined")
  })
})
