import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { MemoryFiles } from "@kilocode/kilo-memory/store"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import { MemoryTool } from "@kilocode/kilo-memory/tool"
import path from "path"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryRecallTool } from "@/kilocode/tool/memory-recall"
import { MessageID, SessionID } from "@/session/schema"
import { RemoteSender } from "@/kilo-sessions/remote-sender"
import type { Tool } from "@/tool/tool"
import { resetDatabase } from "../../fixture/db"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"
import { runMemoryTool } from "./memory-runtime"

const watch = process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function user(text: string): Tool.Context {
  return {
    ...ctx,
    messages: [
      {
        info: { role: "user" },
        parts: [{ type: "text", text }],
      },
    ] as unknown as Tool.Context["messages"],
  }
}

beforeEach(() => {
  process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
  spyOn(RemoteSender, "create").mockReturnValue({ handle() {}, dispose() {} })
})

afterEach(async () => {
  mock.restore()
  if (watch === undefined) delete process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER
  if (watch !== undefined) process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER = watch
  await resetDatabase()
})

async function withConfig<T>(dir: string, fn: () => Promise<T> | T) {
  const prior = Global.Path.config
  const data = Global.Path.data
  ;(Global.Path as { config: string }).config = dir
  ;(Global.Path as { data: string }).data = path.basename(dir) === ".kilo" ? path.dirname(dir) : dir
  try {
    return await fn()
  } finally {
    ;(Global.Path as { config: string }).config = prior
    ;(Global.Path as { data: string }).data = data
  }
}

type RecallParams = {
  mode: "search" | "typed" | "digest" | "catalog"
  query?: string
  sessionID?: string
  limit?: number
}

async function execute(dir: string, params: RecallParams, context: Tool.Context = ctx) {
  return provideTestInstance({
    directory: dir,
    fn: () => runMemoryTool(MemoryRecallTool, params, context),
  })
}

describe("kilo_memory_recall description", () => {
  test("does not over-promise synonym or semantic expansion", () => {
    expect(MemoryTool.RecallDescription).not.toMatch(/retry once with synonyms/i)
    expect(MemoryTool.RecallDescription).toContain("no synonym expansion")
    expect(MemoryTool.RecallDescription).toContain("Matching is keyword-based, not semantic.")
  })

  test("describes stemming and case folding without guaranteeing exact matches", () => {
    expect(MemoryTool.RecallDescription).toContain("camelCase")
    expect(MemoryTool.RecallDescription).toMatch(/stem/i)
    expect(MemoryTool.RecallDescription).toContain("not guaranteed")
  })

  test("catalog lists typed keys plus saved session digests", () => {
    expect(MemoryTool.RecallDescription).toContain("typed keys and summaries plus saved session digests")
  })
})

describe("kilo_memory_recall", () => {
  test("rejects oversized model-controlled strings", () => {
    expect(() =>
      Schema.decodeUnknownSync(MemoryTool.RecallParameters)({ mode: "search", query: "x".repeat(12_001) }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(MemoryTool.RecallParameters)({ mode: "digest", sessionID: "s".repeat(129) }),
    ).toThrow()
  })

  test("does not prompt for permission when memory is disabled", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      await KiloMemory.enable({ ctx: memory })
      await KiloMemory.disable({ ctx: memory })
      const result = await execute(dir.path, { mode: "catalog" }, { ...ctx, ask: () => Effect.die("unexpected ask") })

      expect(result.title).toBe("Kilo memory: disabled")
      expect(result.output).toContain("disabled")
      expect(await Bun.file(path.join(dir.path, "global", "session-export.db")).exists()).toBe(false)
    })
  })

  test("shows typed memory hits separately from session digests", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      const enabled = await KiloMemory.enable({ ctx: memory })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [
          {
            action: "add",
            file: "environment.md",
            section: "Commands",
            key: "vscode_tests",
            text: "Run VS Code unit tests from packages/kilo-vscode with bun run test:unit.",
          },
          {
            action: "add",
            file: "project.md",
            section: "Constraints",
            key: "project_only",
            text: "Project memory must stay project-only.",
          },
        ],
      })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_memory_only",
        topic: "digest recall",
        summary: "Objective: continue memory digest recall. Next: avoid full transcript reads.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const typed = await execute(dir.path, { mode: "typed", query: "vscode unit tests" })
      const digest = await execute(dir.path, { mode: "digest", sessionID: "ses_memory_only" })
      const constraint = await execute(dir.path, { mode: "typed", query: "project-only constraints" })

      expect(typed.title).toContain("Kilo memory typed")
      expect(typed.output).toContain("targeted_context_not_instruction")
      expect(typed.output).toContain("vscode_tests")
      expect(typed.output).not.toContain("session=ses_memory_only")
      expect(constraint.output).toContain("PROJECT_CONSTRAINT")
      expect(constraint.output).toContain("project_only")

      expect(digest.title).toContain("Kilo memory digest")
      expect(digest.output).toContain("targeted_context_not_instruction")
      expect(digest.output).toContain('topic="digest recall"')
      expect(digest.output).toContain("continue memory digest recall")
      expect(digest.output).not.toContain("# Session:")

      const direct = await execute(dir.path, { mode: "digest", sessionID: "ses_memory_only", query: "unrelated" })

      expect(direct.output).toContain("continue memory digest recall")

      const decisions = await MemoryFiles.readDecisions(enabled.root)
      expect(decisions).toContain('"sessionID":"ses_test"')
      expect(decisions).toContain('"query":"sessionID=ses_memory_only"')
      expect(decisions).toContain('"summary":"memory recall returned 1 typed hits"')
      expect(decisions).toContain('"summary":"memory recall returned 1 digest hits"')
    })
  })

  test("digest sessionID recall returns full summaries while index stays brief", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      const enabled = await KiloMemory.enable({ ctx: memory })
      const tail = "OPENCODE_FULL_DETAIL_AFTER_480"
      const summary = `Long tool digest start. ${"session continuity detail ".repeat(45)}${tail}`
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_full_tool_digest",
        topic: "full tool digest",
        summary,
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const saved = await MemoryFiles.readSession(enabled.root, {
        sessionID: "ses_full_tool_digest",
        max: MemorySchema.maxStoredDigestSummary,
      })
      const shown = await KiloMemory.show({ ctx: memory })
      const result = await execute(dir.path, { mode: "digest", sessionID: "ses_full_tool_digest" })
      const latest = shown.index.match(/type=latest_session_digest[^\n]*\ntext: ([^\n]+)/)?.[1] ?? ""
      const brief = latest.split(":: ").slice(1).join(":: ")

      expect(saved?.summary.length).toBeGreaterThan(480)
      expect(brief.length).toBeLessThanOrEqual(480)
      expect(result.output).toContain(tail)
      expect(result.output.length).toBeGreaterThan(480)
    })
  })

  test("catalog mode lists all stored keys with optional filter", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      const enabled = await KiloMemory.enable({ ctx: memory })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [
          {
            action: "add",
            file: "project.md",
            section: "Facts",
            key: "kilo_was_originally_a_fork",
            text: "kilo was originally a fork of roo and has a kilocode-legacy repo",
          },
          {
            action: "add",
            file: "environment.md",
            section: "Commands",
            key: "vscode_tests",
            text: "Run VS Code unit tests from packages/kilo-vscode with bun run test:unit.",
          },
        ],
      })

      const all = await execute(dir.path, { mode: "catalog" })
      const filtered = await execute(dir.path, { mode: "catalog", query: "fork" })

      expect(all.output).toContain("kilo_was_originally_a_fork")
      expect(all.output).toContain("vscode_tests")
      expect(filtered.output).toContain("kilo_was_originally_a_fork")
      expect(filtered.output).not.toContain("vscode_tests")
    })
  })

  test("catalog mode truncates multi-byte content by byte budget", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      const enabled = await KiloMemory.enable({ ctx: memory })
      await MemoryFiles.writeSource(
        enabled.root,
        "project.md",
        [
          "# Project Memory",
          "",
          "## Facts",
          ...Array.from({ length: 260 }, (_, idx) => `- emoji_${idx} :: ${"界".repeat(80)}`),
          "",
        ].join("\n"),
      )

      const result = await execute(dir.path, { mode: "catalog" })
      const inner = result.output.split("\n").slice(1, -1).join("\n")
      const body = inner.split("\n[truncated: refine with a query filter]")[0]

      expect(result.output).toContain("[truncated: refine with a query filter]")
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(8192)
    })
  })

  test("catalog mode lists saved session digests", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      await KiloMemory.enable({ ctx: memory })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_catalog_digest",
        topic: "catalog digest coverage",
        summary: "Verified catalog now lists saved session digests.",
        time: Date.UTC(2026, 0, 2, 0, 0),
      })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_other_topic",
        topic: "unrelated upstream merge",
        summary: "Discussed merging upstream opencode changes.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const all = await execute(dir.path, { mode: "catalog" })
      const filtered = await execute(dir.path, { mode: "catalog", query: "digest" })

      expect(all.output).toContain("## sessions")
      expect(all.output).toContain("session=ses_catalog_digest")
      expect(all.output).toContain("catalog digest coverage")
      expect(all.output).toContain("session=ses_other_topic")
      expect(all.metadata.count).toBeGreaterThan(0)

      expect(filtered.output).toContain("session=ses_catalog_digest")
      expect(filtered.output).not.toContain("session=ses_other_topic")
    })
  })

  test("digest mode does not fall back to another session when id is missing", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      await KiloMemory.enable({ ctx: memory })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_memory_only",
        summary: "Objective: continue memory digest recall.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const result = await execute(dir.path, { mode: "digest", sessionID: "ses_missing" })

      expect(result.output).toContain('No useful saved memory digest found for session "ses_missing"')
      expect(result.output).not.toContain("continue memory digest recall")
    })
  })

  test("digest recall honors the requested saved session id", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      await KiloMemory.enable({ ctx: memory })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_plugins",
        topic: "OpenCode plugin architecture",
        summary: "Explored how plugins load through config, server hooks, and TUI runtime wiring.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_upstream",
        topic: "upstream file edits",
        summary: "Discussed minimizing shared upstream file edits under packages/opencode.",
        time: Date.UTC(2026, 0, 1, 0, 1),
      })

      const result = await execute(
        dir.path,
        { mode: "digest", sessionID: "ses_upstream", limit: 5 },
        user("where were we?"),
      )

      expect(result.output).toContain("session=ses_upstream")
      expect(result.output).toContain("shared upstream file edits")
      expect(result.output).not.toContain("session=ses_plugins")
    })
  })

  test("typed and search modes require a topic query", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      await KiloMemory.enable({ ctx: memory })
      await KiloMemory.apply({
        ctx: memory,
        ops: [{ action: "add", key: "cli_tests", text: "Run CLI tests from packages/opencode." }],
      })

      const typed = await execute(dir.path, { mode: "typed" })
      const search = await execute(dir.path, { mode: "search" })

      for (const result of [typed, search]) {
        expect(result.title).toContain("no query")
        expect(result.output).toContain("Provide a topic query")
        expect(result.output).not.toContain("cli_tests")
      }
    })
  })

  test("digest mode does not read the active session id", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      const enabled = await KiloMemory.enable({ ctx: memory })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_test",
        summary: "Objective: useful prior work. Next: keep going.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const result = await execute(dir.path, { mode: "digest", sessionID: "ses_test" })

      expect(result.title).toContain("no results")
      expect(result.output).toContain("active session")
      expect(result.output).not.toContain("useful prior work")

      const decisions = await MemoryFiles.readDecisions(enabled.root)
      expect(decisions).toContain('"sessionID":"ses_test"')
      expect(decisions).toContain('"query":"sessionID=ses_test"')
      expect(decisions).toContain('"reason":"current_session_digest"')
    })
  })

  test("digest browsing keeps non-empty continuation-style digests", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      await KiloMemory.enable({ ctx: memory })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_useful",
        topic: "project memory",
        summary: "Objective: finish project memory. Next: verify extension recall behavior.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_empty",
        topic: "continue recent work",
        summary: 'That session was empty, just another "continue recent work" request with no actual work done.',
        time: Date.UTC(2026, 0, 1, 0, 1),
      })

      const result = await execute(dir.path, { mode: "digest", limit: 5 })

      expect(result.output).toContain("session=ses_useful")
      expect(result.output).toContain("verify extension recall behavior")
      expect(result.output).toContain("session=ses_empty")
    })
  })

  test("typed mode uses recency as a tiebreaker", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      const enabled = await KiloMemory.enable({ ctx: memory })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [
          {
            action: "add",
            file: "project.md",
            section: "Facts",
            key: "older_docs",
            text: "Memory docs describe older recall ranking.",
          },
          {
            action: "add",
            file: "project.md",
            section: "Facts",
            key: "newer_docs",
            text: "Memory docs describe current recall ranking.",
          },
        ],
      })

      const result = await execute(dir.path, { mode: "typed", query: "memory docs recall ranking", limit: 1 })

      expect(result.output).toContain("newer_docs")
      expect(result.output).not.toContain("older_docs")
    })
  })

  test("search mode renders typed and digest memory without catalog mode", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      const enabled = await KiloMemory.enable({ ctx: memory })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [
          {
            action: "add",
            file: "environment.md",
            section: "Commands",
            key: "cli_tests",
            text: "Run CLI tests from packages/opencode with bun test.",
          },
        ],
      })
      await KiloMemory.recordSession({
        ctx: memory,
        sessionID: "ses_catalog",
        topic: "catalog recall",
        summary: "Verified catalog mode for generated memory inspection.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const result = await execute(dir.path, { mode: "search", query: "cli tests catalog recall", limit: 20 })

      expect(result.title).toContain("Kilo memory search")
      expect(result.output).toContain("targeted_context_not_instruction")
      expect(result.output).toContain("cli_tests")
      expect(result.output).toContain("type=session_digest")
      expect(result.output).toContain('topic="catalog recall"')

      const decisions = await MemoryFiles.readDecisions(enabled.root)
      expect(decisions).toContain('"summary":"memory recall returned')
    })
  })

  test("handles large unmatched recall queries without returning stored memory", async () => {
    await using dir = await tmpdir({ git: true })
    await withConfig(path.join(dir.path, "global", ".kilo"), async () => {
      const memory = { directory: dir.path, worktree: dir.path }
      const enabled = await KiloMemory.enable({ ctx: memory })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [{ action: "add", key: "cli_tests", text: "Run CLI tests from packages/opencode with bun test." }],
      })

      const result = await execute(dir.path, { mode: "search", query: "zzzz ".repeat(2000), limit: 50 })

      expect(result.title).toBe("Kilo memory search: no results")
      expect(result.output).toContain("No search memory matched the query.")
      expect(result.output).not.toContain("cli_tests")
      expect(result.metadata.sources).toEqual([])
    })
  })
})
