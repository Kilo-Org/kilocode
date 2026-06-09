import { expect, test } from "bun:test"
import { resolveBaseBranch } from "./config"

test("resolves HEAD to the current branch", () => {
  expect(resolveBaseBranch("HEAD", "session/agent-123")).toBe("session/agent-123")
})

test("keeps explicit base branch names", () => {
  expect(resolveBaseBranch("main", "session/agent-123")).toBe("main")
  expect(resolveBaseBranch(undefined, "session/agent-123")).toBeUndefined()
})

test("rejects HEAD when detached", () => {
  expect(() => resolveBaseBranch("HEAD", "HEAD")).toThrow("--base-branch HEAD requires a named branch")
})
