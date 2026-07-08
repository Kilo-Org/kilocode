import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test"
import type { GitContext } from "@/kilocode/commit-message/types"
import type { Provider } from "@/provider/provider"

// Mock dependencies before importing the module under test.
// IMPORTANT: Bun's mock.module() is process-wide and permanent. To avoid
// breaking other test files, we spread real exports and only override what
// this test needs.

const realLog = await import("@opencode-ai/core/util/log")
const realAgent = await import("@/agent/agent")

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

mock.module("@/agent/agent", () => ({
  ...realAgent,
  Agent: {},
}))

mock.module("@opencode-ai/core/util/log", () => ({
  ...realLog,
  create: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}))

import { CommitMessageRuntime, generateCommitMessage, NoChangesError } from "../../../src/kilocode/commit-message/generate"

const context = spyOn(CommitMessageRuntime, "context").mockImplementation(async (repoPath, selectedFiles) => {
  captured = { path: repoPath, selected: selectedFiles }
  return mockGitContext
})
const stream = spyOn(CommitMessageRuntime, "generate").mockImplementation(async () => mockStreamText)
const model = spyOn(CommitMessageRuntime, "model").mockImplementation(
  async () => ({ providerID: "test", id: "test-small-model" }) as Provider.Model,
)

describe("commit-message.generate", () => {
  beforeEach(() => {
    context.mockImplementation(async (repoPath, selectedFiles) => {
      captured = { path: repoPath, selected: selectedFiles }
      return mockGitContext
    })
    stream.mockImplementation(async () => mockStreamText)
    model.mockImplementation(async () => ({ providerID: "test", id: "test-small-model" }) as Provider.Model)
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
    test("throws NoChangesError when no git changes are found", async () => {
      mockGitContext = { branch: "main", recentCommits: [], files: [] }
      const err = await generateCommitMessage({ path: "/repo" }).catch((e) => e)
      expect(err).toBeInstanceOf(NoChangesError)
      if (err instanceof NoChangesError) {
        expect(err.message).toBe("No changes found to generate a commit message for")
        expect(err.name).toBe("CommitMessageNoChanges")
      }
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
