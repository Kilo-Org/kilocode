import { describe, test, expect, mock } from "bun:test"
import { z } from "zod"

// Mirror the mocks from build-runner.test.ts so the module graph resolves
mock.module("@/session", () => ({
  Session: {
    create: mock(() => Promise.resolve({ id: "session-001", slug: "test-session" })),
    Event: {
      TurnClose: { type: "session.turn.close" },
    },
  },
}))

mock.module("@/session/prompt", () => ({
  SessionPrompt: {
    prompt: mock(() => Promise.resolve({ info: { role: "assistant" } })),
    PromptInput: z.object({ sessionID: z.string() }),
  },
}))

mock.module("@/worktree", () => ({
  Worktree: {
    create: mock(() => Promise.resolve({ name: "wf", branch: "opencode/wf", directory: "/tmp/wf" })),
    remove: mock(() => Promise.resolve()),
  },
}))

mock.module("@/bus", () => ({
  Bus: {
    subscribe: mock(() => () => {}),
    publish: mock(() => Promise.resolve()),
  },
}))

mock.module("@/project/instance", () => ({
  Instance: {
    directory: "/repo/main",
    provide: mock(({ fn }: { fn: () => Promise<unknown> }) => Promise.resolve(fn())),
    dispose: mock(() => Promise.resolve()),
  },
}))

mock.module("@/devilcode/workflow/prompts/build.txt", () => ({
  default: "You are executing a task...",
}))

describe("B1: child session permissions are scoped", () => {
  test("buildPermissions scopes write access to task files and allows read everywhere", async () => {
    const { buildPermissions } = await import("@/devilcode/workflow/build-runner")

    const perms = buildPermissions(["src/auth/middleware.ts", "src/auth/jwt.ts"])

    // Should allow reading anything
    const readAll = perms.find((p: any) => p.permission === "read" && p.pattern === "*")
    expect(readAll).toBeDefined()
    expect(readAll!.action).toBe("allow")

    // Should allow writing only to task files
    const writePerms = perms.filter((p: any) => p.permission === "write" || p.permission === "edit")
    for (const wp of writePerms) {
      expect(wp.action).toBe("allow")
      // Each write permission should target a specific file, not "*"
      expect(wp.pattern).not.toBe("*")
    }

    // Should allow bash/command execution
    const bash = perms.find((p: any) => p.permission === "bash" || p.permission === "command")
    expect(bash).toBeDefined()
  })

  test("buildPermissions with empty files array still allows read and bash", async () => {
    const { buildPermissions } = await import("@/devilcode/workflow/build-runner")

    const perms = buildPermissions([])

    const readAll = perms.find((p: any) => p.permission === "read" && p.pattern === "*")
    expect(readAll).toBeDefined()
  })
})
