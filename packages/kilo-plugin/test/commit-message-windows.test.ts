import { expect, spyOn, test } from "bun:test"
import { CommitMessageGit } from "../src/commit-message/git-context"

test("git subprocesses of the commit message context hide the Windows console window", () => {
  const out = new Map([
    ["branch --show-current", "main"],
    ["log --oneline -5", "abc1234 init"],
    ["diff --name-status --cached", "M\tsrc/index.ts"],
    ["diff --cached -- src/index.ts", "+console.log('hi')"],
  ])
  const spy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: unknown) => {
    const key = Array.isArray(cmd) ? cmd.slice(1).join(" ") : ""
    return { stdout: Buffer.from(out.get(key) ?? ""), stderr: Buffer.alloc(0) } as never
  }) as unknown as typeof Bun.spawnSync)
  try {
    expect(CommitMessageGit.getGitContext("/repo").files).toEqual([
      { status: "modified", path: "src/index.ts", diff: "+console.log('hi')" },
    ])
    expect(spy).toHaveBeenCalledTimes(4)
    for (const call of spy.mock.calls) {
      expect(call[0]).toEqual(expect.arrayContaining(["git"]))
      expect(call[1]).toMatchObject({ cwd: "/repo", stdout: "pipe", stderr: "pipe", windowsHide: true })
    }
  } finally {
    spy.mockRestore()
  }
})
