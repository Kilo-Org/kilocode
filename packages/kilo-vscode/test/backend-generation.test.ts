import { expect, test } from "bun:test"
import {
  createGenerationMethods,
  cleanEnhancedPrompt,
  cleanCommitMessage,
  parseBranchName,
  ENHANCE_PROMPT_INSTRUCTION,
  COMMIT_MESSAGE_SYSTEM_PROMPT,
  BRANCH_NAME_PROMPT,
} from "../src/backend/generation"

// If executed as a child worker under sandbox-exec, run the real host acceptance verification
if (process.argv.includes("--fixture-worker")) {
  const { Effect } = await import("effect")
  const { appHost } = await import("./app-host")

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* appHost
        const adapter = createGenerationMethods(host.verified.client, process.cwd())

        yield* Effect.promise(async () => {
          // Capture initial session and message state before generation
          const initialSessions = await host.verified.client.session.list({
            directory: process.cwd(),
          })
          const sessionCount = (initialSessions.data ?? []).length

          const initialMessages = await host.verified.client.message.list({
            sessionID: host.session.id,
          })
          const messageHistory = initialMessages.data
          const initialRequestCount = host.requests.length

          // 1. enhancePrompt against real host (must succeed against project fixture model)
          const enhanced = await adapter.enhancePrompt.enhance(
            { text: "add login button", directory: process.cwd() },
            { throwOnError: true },
          )
          expect(enhanced.data).toBeDefined()
          expect(typeof enhanced.data.text).toBe("string")
          expect(enhanced.data.text.length).toBeGreaterThan(0)
          expect(host.requests.length).toBeGreaterThan(initialRequestCount)

          // 2. branchName against real host
          const branched = await adapter.branchName.generate(
            { prompt: "fix token expiration race condition", sessionID: host.session.id, directory: process.cwd() },
            { throwOnError: true },
          )
          expect(branched.data).toBeDefined()
          expect(typeof branched.data.branch).toBe("string")
          expect(branched.data.branch?.length).toBeGreaterThan(0)

          const commit = await adapter.commitMessage.generate(
            { directory: process.cwd(), diff: "diff --git a/login.ts b/login.ts\n+const scopedGeneration = true" },
            { throwOnError: true },
          )
          expect(commit.data.message.length).toBeGreaterThan(0)
          expect(host.requests.some((request) => request.includes("scopedGeneration"))).toBe(true)
          // 3. Stateless generation invariants: NO sessions created, NO messages mutated
          const afterSessions = await host.verified.client.session.list({
            directory: process.cwd(),
          })
          expect((afterSessions.data ?? []).length).toBe(sessionCount)

          const afterMessages = await host.verified.client.message.list({
            sessionID: host.session.id,
          })
          expect(afterMessages.data).toEqual(messageHistory)

          // 4. Explicit negative case: commitMessage refusal when no changes
          const { mkdtemp, rm } = await import("node:fs/promises")
          const os = await import("node:os")
          const path = await import("node:path")
          const emptyDir = await mkdtemp(path.join(os.tmpdir(), "kilo-empty-repo-"))

          await expect(
            adapter.commitMessage.generate({ directory: emptyDir }, { throwOnError: true }),
          ).rejects.toThrow(/No changes found/i)

          await rm(emptyDir, { recursive: true, force: true })

          console.log("EXISTING_UI_GENERATION_PASS")
        })
      }),
    ),
  )
  process.exit(0)
}

test("cleanEnhancedPrompt strips code fences and quotes", () => {
  expect(cleanEnhancedPrompt("```markdown\nRefactored prompt\n```")).toBe("Refactored prompt")
  expect(cleanEnhancedPrompt('"Refactored prompt"')).toBe("Refactored prompt")
  expect(cleanEnhancedPrompt("'Refactored prompt'")).toBe("Refactored prompt")
  expect(cleanEnhancedPrompt("   Refactored prompt   ")).toBe("Refactored prompt")
})

test("cleanCommitMessage cleans markdown blocks and quotes", () => {
  expect(cleanCommitMessage("```\nfeat(auth): add OAuth provider\n```")).toBe(
    "feat(auth): add OAuth provider",
  )
  expect(cleanCommitMessage('"feat: simple feature"')).toBe("feat: simple feature")
})

test("parseBranchName parses branch slug, strips think tags, and enforces kebab-case", () => {
  expect(parseBranchName("<think>some reasoning</think>\nfeat-user-auth")).toBe("feat-user-auth")
  expect(parseBranchName("fix: token refresh race!")).toBe("fix-token-refresh-race")
  expect(parseBranchName("null")).toBeNull()
  expect(parseBranchName("")).toBeNull()
  expect(parseBranchName("a".repeat(100))).toBe("a".repeat(50))
})

test.skipIf(process.platform !== "darwin")(
  "real isolated kilo-cli host verifies generation adapter",
  async () => {
    const { fixture } = await import("../../kilo-cli/test/fixture")
    const { writeFile } = await import("node:fs/promises")
    const path = await import("node:path")

    await using input = await fixture()
    const policy = path.join(input.directory, "network.sb")
    await writeFile(
      policy,
      '(version 1) (allow default) (deny network-outbound) (allow network-outbound (remote ip "localhost:*"))',
    )

    const fs = await import("node:fs")
    const bunBin = fs.existsSync(path.resolve(import.meta.dir, "../../kilo-cli/dist/interactive/bun"))
      ? path.resolve(import.meta.dir, "../../kilo-cli/dist/interactive/bun")
      : process.execPath

    const child = Bun.spawn(
      [
        "/usr/bin/sandbox-exec",
        "-f",
        policy,
        bunBin,
        path.join(import.meta.dir, "backend-generation.test.ts"),
        "--fixture-worker",
      ],
      {
        cwd: input.cwd,
        env: input.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const timeout = setTimeout(() => child.kill("SIGKILL"), 25_000)
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect({ code, error: code ? stdout + stderr : "" }).toEqual({ code: 0, error: "" })
      expect(stdout).toContain("EXISTING_UI_GENERATION_PASS")
    } finally {
      clearTimeout(timeout)
    }
  },
  30_000,
)
