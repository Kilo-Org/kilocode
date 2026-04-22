import { describe, expect, test, mock, beforeEach } from "bun:test"
import type { GitContext } from "@/kilocode/commit-message/types"

// Mock dependencies before importing the module under test.
// IMPORTANT: Bun's mock.module() is process-wide and permanent. To avoid
// breaking other test files, we spread real exports and only override what
// this test needs.

const realLog = await import("@/util")
const realProvider = await import("@/provider")
const realLLM = await import("@/session/llm")
const realAgent = await import("@/agent/agent")
const realGitContext = await import("@/kilocode/commit-message/git-context")

let mockStreamText = "feat(src): add hello world logging"

const defaultGitContext: GitContext = {
  branch: "main",
  recentCommits: ["abc1234 initial commit"],
  files: [
    {
      status: "modified",
      path: "src/index.ts",
      diff: "+console.log('hello')",
    },
  ],
}

let mockGitContext: GitContext = { ...defaultGitContext }
let captured: { path: string; selected?: string[] } = { path: "" }

mock.module("@/kilocode/commit-message/git-context", () => ({
  ...realGitContext,
  getGitContext: async (repoPath: string, selectedFiles?: string[]) => {
    captured = { path: repoPath, selected: selectedFiles }
    return mockGitContext
  },
}))

mock.module("@/provider", () => ({
  ...realProvider,
  Provider: {
    ...realProvider.Provider,
    defaultModel: async () => ({ providerID: "test", modelID: "test-model" }),
    getSmallModel: async () => ({
      providerID: "test",
      id: "test-small-model",
    }),
    getModel: async () => ({ providerID: "test", id: "test-model" }),
  },
}))

mock.module("@/session/llm", () => ({
  ...realLLM,
  LLM: {
    ...realLLM.LLM,
    stream: async () => ({
      textStream: (async function* () {
        yield mockStreamText
      })(),
      text: Promise.resolve(mockStreamText),
    }),
  },
}))

mock.module("@/agent/agent", () => ({
  ...realAgent,
  Agent: {},
}))

mock.module("@/util", () => ({
  ...realLog,
  Log: {
    ...realLog.Log,
    create: () => ({
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    }),
  },
}))

import { generateCommitMessage } from "../../../src/kilocode/commit-message/generate"

describe("commit-message.generate", () => {
  beforeEach(() => {
    mockStreamText = "feat(src): add hello world logging"
    mockGitContext = { ...defaultGitContext }
    captured = { path: "" }
  })

  describe("prompt construction", () => {
    test("passes path to getGitContext", async () => {
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBeTruthy()
      expect(captured.path).toBe("/repo")
    })

    test("generates message from git context with multiple files", async () => {
      mockStreamText = "feat(api): add api module"
      mockGitContext = {
        branch: "main",
        recentCommits: ["abc1234 initial commit"],
        files: [
          { status: "added", path: "src/api.ts", diff: "+export function api() {}" },
          { status: "modified", path: "src/index.ts", diff: "+import { api } from './api'" },
        ],
      }
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBe("feat(api): add api module")
    })
  })

  describe("response cleaning", () => {
    test("strips code block markers from response", async () => {
      mockStreamText = "```\nfeat: add feature\n```"
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBe("feat: add feature")
    })

    test("strips code block markers with language tag", async () => {
      mockStreamText = "```text\nfix(auth): resolve token refresh\n```"
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBe("fix(auth): resolve token refresh")
    })

    test("strips surrounding double quotes", async () => {
      mockStreamText = '"feat: add new feature"'
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBe("feat: add new feature")
    })

    test("strips surrounding single quotes", async () => {
      mockStreamText = "'fix: resolve bug'"
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBe("fix: resolve bug")
    })

    test("strips whitespace around the message", async () => {
      mockStreamText = "  \n  chore: update deps  \n  "
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBe("chore: update deps")
    })

    test("strips code blocks AND quotes together", async () => {
      mockStreamText = '```\n"refactor: simplify logic"\n```'
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBe("refactor: simplify logic")
    })

    test("returns clean message when no markers present", async () => {
      mockStreamText = "docs: update readme"
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBe("docs: update readme")
    })
  })

  describe("error on no changes", () => {
    test("throws when no git changes are found", async () => {
      mockGitContext = { branch: "main", recentCommits: [], files: [] }
      await expect(generateCommitMessage({ path: "/repo" })).rejects.toThrow(
        "No changes found to generate a commit message for",
      )
    })
  })

  describe("selectedFiles pass-through", () => {
    test("passes selectedFiles to getGitContext", async () => {
      const result = await generateCommitMessage({
        path: "/repo",
        selectedFiles: ["src/a.ts"],
      })
      expect(result.message).toBeTruthy()
      expect(captured.path).toBe("/repo")
      expect(captured.selected).toEqual(["src/a.ts"])
    })
  })

  describe("custom prompt", () => {
    test("uses default prompt when no custom prompt provided", async () => {
      const result = await generateCommitMessage({ path: "/repo" })
      expect(result.message).toBeTruthy()
    })

    test("uses custom prompt when provided", async () => {
      const result = await generateCommitMessage({ path: "/repo", prompt: "Write a haiku commit message." })
      expect(result.message).toBeTruthy()
    })
  })
})
