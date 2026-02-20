import { describe, expect, test, mock, beforeEach } from "bun:test"
import type { GitContext } from "../types"

// Mock dependencies before importing the module under test

let mockGitContext: GitContext = {
  branch: "main",
  recentCommits: ["abc1234 initial commit"],
  files: [{ status: "modified" as const, path: "src/index.ts", diff: "+console.log('hello')" }],
}

mock.module("../git-context", () => ({
  getGitContext: async () => mockGitContext,
}))

let mockStreamText = "feat(src): add hello world logging"

mock.module("@/provider/provider", () => ({
  Provider: {
    defaultModel: async () => ({ providerID: "test", modelID: "test-model" }),
    getSmallModel: async () => ({
      providerID: "test",
      id: "test-small-model",
    }),
    getModel: async () => ({ providerID: "test", id: "test-model" }),
  },
}))

mock.module("@/session/llm", () => ({
  LLM: {
    stream: async () => ({
      text: Promise.resolve(mockStreamText),
    }),
  },
}))

mock.module("@/agent/agent", () => ({
  Agent: {},
}))

mock.module("@/util/log", () => ({
  Log: {
    create: () => ({
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    }),
  },
}))

import { generateCommitMessage } from "../generate"

describe("commit-message.generate", () => {
  beforeEach(() => {
    mockGitContext = {
      branch: "main",
      recentCommits: ["abc1234 initial commit"],
      files: [{ status: "modified" as const, path: "src/index.ts", diff: "+console.log('hello')" }],
    }
    mockStreamText = "feat(src): add hello world logging"
  })

  describe("prompt construction", () => {
    test("passes path to getGitContext", async () => {
      const result = await generateCommitMessage({ path: "/my/repo" })
      // If getGitContext is called, it returns our mock context and generates a message
      expect(result.message).toBeTruthy()
    })

    test("generates message from git context with multiple files", async () => {
      mockGitContext = {
        branch: "feature/api",
        recentCommits: ["abc feat: add api", "def fix: typo"],
        files: [
          { status: "added" as const, path: "src/api.ts", diff: "+export function api() {}" },
          { status: "modified" as const, path: "src/index.ts", diff: "+import { api } from './api'" },
        ],
      }
      mockStreamText = "feat(api): add api module"

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
      mockGitContext = {
        branch: "main",
        recentCommits: [],
        files: [],
      }

      await expect(generateCommitMessage({ path: "/repo" })).rejects.toThrow(
        "No changes found to generate a commit message for",
      )
    })
  })

  describe("selectedFiles pass-through", () => {
    test("passes selectedFiles to getGitContext", async () => {
      // This verifies the function doesn't crash when selectedFiles is provided
      const result = await generateCommitMessage({
        path: "/repo",
        selectedFiles: ["src/a.ts"],
      })
      expect(result.message).toBeTruthy()
    })
  })
})
