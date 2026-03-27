import { describe, expect, spyOn, test } from "bun:test"
import { getGitContext } from "../../src/commit-message/git-context"

describe("commit-message git context", () => {
  test("hides Windows console windows for git subprocesses", async () => {
    const out = new Map([
      ["branch --show-current", "main"],
      ["log --oneline -5", "abc1234 init"],
      ["diff --name-status --cached", "M\tsrc/index.ts"],
      ["diff --cached -- src/index.ts", "+console.log('hi')"],
    ])

    const spy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: unknown, opts: unknown) => {
      const key = Array.isArray(cmd) ? cmd.slice(1).join(" ") : ""
      return {
        stdout: Buffer.from(out.get(key) ?? ""),
        stderr: Buffer.alloc(0),
      } as never
    }) as unknown as typeof Bun.spawnSync)

    try {
      await getGitContext("/repo")

      expect(spy).toHaveBeenCalledTimes(4)
      for (const call of spy.mock.calls) {
        expect(call[0]).toEqual(expect.arrayContaining(["git"]))
        expect(call[1]).toMatchObject({
          cwd: "/repo",
          stdout: "pipe",
          stderr: "pipe",
          windowsHide: true,
        })
      }
    } finally {
      spy.mockRestore()
    }
  })
})
