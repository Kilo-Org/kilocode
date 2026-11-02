import { describe, expect, test } from "bun:test"
import { Model } from "@opencode/schema/model"
import { Effect, Exit, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../../core/test/lib/effect"
import { CommitMessageGenerate } from "../src/commit-message/generate"
import type { GitContext } from "../src/commit-message/git-context"

const small = Model.Ref.make({ providerID: "test" as Model.Ref["providerID"], id: "test-small-model" as Model.Ref["id"] })
const changes: GitContext = {
  branch: "main",
  recentCommits: ["abc1234 initial commit"],
  files: [{ status: "modified", path: "src/index.ts", diff: "+console.log('hello')" }],
}

// Runs `generate` against a fake git context and model, and records what reached them.
function run(
  request: CommitMessageGenerate.Request,
  options: { context?: GitContext; text?: Effect.Effect<string, unknown> } = {},
) {
  const calls = { context: [] as [string, readonly string[] | undefined][], text: [] as { prompt: string; model?: Model.Ref }[] }
  const runtime: CommitMessageGenerate.Runtime = {
    context: (path, selectedFiles) => {
      calls.context.push([path, selectedFiles])
      return Effect.succeed(options.context ?? changes)
    },
    model: () => Effect.succeed(small),
    text: (input) => {
      calls.text.push(input)
      return options.text ?? Effect.succeed("feat(src): add hello world logging")
    },
  }
  return Effect.runPromiseExit(CommitMessageGenerate.generate(request, runtime)).then((exit) => ({ exit, calls }))
}

async function message(text: string) {
  const result = await run({ path: "/repo" }, { text: Effect.succeed(text) })
  if (!Exit.isSuccess(result.exit)) throw new Error("expected a message")
  return result.exit.value.message
}

async function failure(result: Promise<{ exit: Exit.Exit<unknown, unknown> }>) {
  const exit = (await result).exit
  if (!Exit.isFailure(exit) || exit.cause.reasons[0]?._tag !== "Fail") throw new Error("expected a failure")
  return exit.cause.reasons[0].error as { _tag: string; message: string }
}

const it = testEffect(Layer.empty)

describe("commit message generation", () => {
  test("passes the repository path, the selected files and the small model through", async () => {
    const result = await run({ path: "/repo", selectedFiles: ["src/a.ts"] })
    expect(result.calls.context).toEqual([["/repo", ["src/a.ts"]]])
    expect(result.calls.text[0]!.model).toEqual(small)
  })

  test("the prompt has the instructions, the branch, the recent commits, the files and the diffs", async () => {
    const context: GitContext = {
      branch: "feature/api",
      recentCommits: ["abc1234 initial commit"],
      files: [
        { status: "added", path: "src/api.ts", diff: "+export function api() {}" },
        { status: "modified", path: "src/index.ts", diff: "+import { api } from './api'" },
      ],
    }
    const prompt = (await run({ path: "/repo" }, { context })).calls.text[0]!.prompt
    expect(prompt.startsWith(CommitMessageGenerate.SYSTEM_PROMPT)).toBe(true)
    expect(prompt).toContain("Branch: feature/api\nRecent commits:\nabc1234 initial commit")
    expect(prompt).toContain("Changed files:\nadded src/api.ts\nmodified src/index.ts")
    expect(prompt).toContain("--- src/api.ts ---\n+export function api() {}\n\n--- src/index.ts ---")
    expect(prompt).not.toContain("COMPLETELY DIFFERENT")
  })

  test("a previous message asks for a different one", async () => {
    const prompt = (await run({ path: "/repo", previousMessage: "feat: old" })).calls.text[0]!.prompt
    expect(prompt).toContain('Generate a COMPLETELY DIFFERENT commit message from the previous one. The previous message was: "feat: old"')
  })

  test("cleans code fences, quotes and whitespace from the answer", async () => {
    expect(await message("```\nfeat: add feature\n```")).toBe("feat: add feature")
    expect(await message("```text\nfix(auth): resolve token refresh\n```")).toBe("fix(auth): resolve token refresh")
    expect(await message('"feat: add new feature"')).toBe("feat: add new feature")
    expect(await message("'fix: resolve bug'")).toBe("fix: resolve bug")
    expect(await message("  \n  chore: update deps  \n  ")).toBe("chore: update deps")
    expect(await message('```\n"refactor: simplify logic"\n```')).toBe("refactor: simplify logic")
    expect(await message("docs: update readme")).toBe("docs: update readme")
  })

  test("fails with no_changes and does not call the model when there is nothing to describe", async () => {
    const result = run({ path: "/repo" }, { context: { branch: "main", recentCommits: [], files: [] } })
    expect(await failure(result)).toMatchObject({
      _tag: "CommitMessage.NoChangesError",
      message: "No changes found to generate a commit message for",
    })
    expect((await result).calls.text).toEqual([])
  })

  test("a model failure keeps its message", async () => {
    const error = new Error("request exceeds the available context size (4096 tokens)")
    expect(await failure(run({ path: "/repo" }, { text: Effect.fail(error) }))).toMatchObject({
      _tag: "CommitMessage.FailedError",
      message: "Failed to generate commit message: request exceeds the available context size (4096 tokens)",
    })
    expect(await failure(run({ path: "/repo" }, { text: Effect.fail({ message: "provider rate limited" }) }))).toMatchObject({
      message: "Failed to generate commit message: provider rate limited",
    })
  })

  test("a custom prompt replaces the default instructions", async () => {
    const prompt = (await run({ path: "/repo", prompt: "Write a haiku commit message." })).calls.text[0]!.prompt
    expect(prompt.startsWith("Write a haiku commit message.")).toBe(true)
    expect(prompt).not.toContain("Conventional Commits Format")
  })

  test("adds the language requirement only for a language other than English", async () => {
    const prompt = async (request: Omit<CommitMessageGenerate.Request, "path">) =>
      (await run({ path: "/repo", ...request })).calls.text[0]!.prompt
    expect(await prompt({})).not.toContain("Language Requirement")
    expect(await prompt({ language: "en" })).not.toContain("Language Requirement")
    expect(await prompt({ language: "zh" })).toContain("Language Requirement")
    expect(await prompt({ language: "zh" })).toContain("following language: zh")
    const custom = await prompt({ prompt: "Write a haiku commit message.", language: "zh" })
    expect(custom).toContain("Write a haiku commit message.")
    expect(custom).toContain("Language Requirement")
  })

  test("errorMessage reads Errors, tagged values and provider data", () => {
    expect(CommitMessageGenerate.errorMessage(new Error("boom"))).toBe("boom")
    expect(CommitMessageGenerate.errorMessage(Object.assign(new Error(""), { name: "AbortError" }))).toBe("AbortError")
    expect(CommitMessageGenerate.errorMessage({ _tag: "Generate.UnavailableError", message: "no credits" })).toBe("no credits")
    expect(CommitMessageGenerate.errorMessage({ data: { message: "context too long" } })).toBe("context too long")
    expect(CommitMessageGenerate.errorMessage("plain")).toBe("plain")
    expect(CommitMessageGenerate.errorMessage({ code: 500 })).toBe('{"code":500}')
    expect(CommitMessageGenerate.errorMessage({})).toBe("unknown error")
  })

  it.effect("a model that does not answer in 30 seconds fails with a timeout", () =>
    Effect.gen(function* () {
      const runtime: CommitMessageGenerate.Runtime = {
        context: () => Effect.succeed(changes),
        model: () => Effect.succeed(small),
        text: () => Effect.never,
      }
      const fiber = yield* CommitMessageGenerate.generate({ path: "/repo" }, runtime).pipe(
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* TestClock.adjust("30 seconds")
      expect(yield* Fiber.join(fiber)).toMatchObject({
        _tag: "CommitMessage.FailedError",
        message: "Commit message generation timed out after 30 seconds",
      })
    }),
  )
})
