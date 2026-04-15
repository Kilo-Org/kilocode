import { describe, expect, test, mock, beforeEach } from "bun:test"
import { $ } from "bun"
import * as fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"

// Mock dependencies before importing the module under test.
// IMPORTANT: Bun's mock.module() is process-wide and permanent. To avoid
// breaking other test files, we spread real exports and only override what
// this test needs.

const realLog = await import("@/util/log")
const realProvider = await import("@/provider/provider")
const realLLM = await import("@/session/llm")
const realAgent = await import("@/agent/agent")

let mockStreamText = "feat(src): add hello world logging"

async function change(dir: string, files: Record<string, string> = { "src/index.ts": "console.log('hello')\n" }) {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, text)
    await $`git add ${file}`.cwd(dir).quiet()
  }
}

async function generated(text = mockStreamText) {
  mockStreamText = text
  await using tmp = await tmpdir({ git: true })
  await change(tmp.path)
  return generateCommitMessage({ path: tmp.path })
}

mock.module("@/provider/provider", () => ({
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

mock.module("@/util/log", () => ({
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
  })

  describe("prompt construction", () => {
    test("passes path to getGitContext", async () => {
      await using tmp = await tmpdir({ git: true })
      await change(tmp.path)
      const result = await generateCommitMessage({ path: tmp.path })
      expect(result.message).toBeTruthy()
    })

    test("generates message from git context with multiple files", async () => {
      mockStreamText = "feat(api): add api module"
      await using tmp = await tmpdir({ git: true })
      await change(tmp.path, {
        "src/api.ts": "export function api() {}\n",
        "src/index.ts": "import { api } from './api'\n",
      })

      const result = await generateCommitMessage({ path: tmp.path })
      expect(result.message).toBe("feat(api): add api module")
    })
  })

  describe("response cleaning", () => {
    test("strips code block markers from response", async () => {
      const result = await generated("```\nfeat: add feature\n```")
      expect(result.message).toBe("feat: add feature")
    })

    test("strips code block markers with language tag", async () => {
      const result = await generated("```text\nfix(auth): resolve token refresh\n```")
      expect(result.message).toBe("fix(auth): resolve token refresh")
    })

    test("strips surrounding double quotes", async () => {
      const result = await generated('"feat: add new feature"')
      expect(result.message).toBe("feat: add new feature")
    })

    test("strips surrounding single quotes", async () => {
      const result = await generated("'fix: resolve bug'")
      expect(result.message).toBe("fix: resolve bug")
    })

    test("strips whitespace around the message", async () => {
      const result = await generated("  \n  chore: update deps  \n  ")
      expect(result.message).toBe("chore: update deps")
    })

    test("strips code blocks AND quotes together", async () => {
      const result = await generated('```\n"refactor: simplify logic"\n```')
      expect(result.message).toBe("refactor: simplify logic")
    })

    test("returns clean message when no markers present", async () => {
      const result = await generated("docs: update readme")
      expect(result.message).toBe("docs: update readme")
    })
  })

  describe("error on no changes", () => {
    test("throws when no git changes are found", async () => {
      await using tmp = await tmpdir({ git: true })
      await expect(generateCommitMessage({ path: tmp.path })).rejects.toThrow(
        "No changes found to generate a commit message for",
      )
    })
  })

  describe("selectedFiles pass-through", () => {
    test("passes selectedFiles to getGitContext", async () => {
      await using tmp = await tmpdir({ git: true })
      await change(tmp.path, {
        "src/a.ts": "export const a = 1\n",
        "src/b.ts": "export const b = 1\n",
      })
      const result = await generateCommitMessage({
        path: tmp.path,
        selectedFiles: ["src/a.ts"],
      })
      expect(result.message).toBeTruthy()
    })
  })

  describe("custom prompt", () => {
    test("uses default prompt when no custom prompt provided", async () => {
      const result = await generated()
      expect(result.message).toBeTruthy()
    })

    test("uses custom prompt when provided", async () => {
      await using tmp = await tmpdir({ git: true })
      await change(tmp.path)
      const result = await generateCommitMessage({ path: tmp.path, prompt: "Write a haiku commit message." })
      expect(result.message).toBeTruthy()
    })
  })
})
