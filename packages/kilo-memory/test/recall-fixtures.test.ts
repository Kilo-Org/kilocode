import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Memory } from "../src/memory"
import { MemoryRecall } from "../src/recall/recall"

async function tmp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-memory-recall-"))
  return {
    dir,
    root: path.join(dir, "memory"),
    async done() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function use(fn: (input: Awaited<ReturnType<typeof tmp>>) => Promise<void>) {
  const t = await tmp()
  try {
    await fn(t)
  } finally {
    await t.done()
  }
}

describe("memory recall lexical fixtures", () => {
  test("expected hit: exact key match returns typed memory", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "cli_tests",
        text: "Run CLI tests from packages/opencode with bun test.",
      })

      const result = await MemoryRecall.search({ root: t.root, query: "cli_tests" })

      expect(result?.hits[0]?.type).toBe("typed")
      expect(result?.block).toContain("cli_tests")
    })
  })

  test("expected hit: phrasing mismatch works when anchor terms overlap", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "cli_tests",
        text: "Run CLI tests from packages/opencode with bun test.",
      })

      const result = await MemoryRecall.search({ root: t.root, query: "which packages/opencode command checks CLI?" })

      expect(result?.block).toContain("cli_tests")
    })
  })

  test("expected miss: synonym-only query is not semantic recall", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "cli_tests",
        text: "Run CLI tests from packages/opencode with bun test.",
      })

      const result = await MemoryRecall.search({ root: t.root, query: "execute verification suite" })

      expect(result).toBeUndefined()
    })
  })

  test("expected hit: path and tool query finds environment memory", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        file: "environment.md",
        section: "Commands",
        key: "opencode_memory_tests",
        text: "Run bun test ./test/kilocode/memory from packages/opencode.",
      })

      const result = await MemoryRecall.search({ root: t.root, query: "bun packages/opencode memory" })

      expect(result?.hits[0]?.source).toBe("environment.md")
      expect(result?.block).toContain("opencode_memory_tests")
    })
  })

  test("expected hit: non-English stored text remains lexical", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "設定",
        text: "日本語の設定は packages/kilo-vscode に保存します。",
      })

      const result = await MemoryRecall.search({ root: t.root, query: "日本語 設定" })

      expect(result?.block).toContain("設定")
      expect(result?.block).toContain("日本語")
    })
  })

  test("expected digest fallback: requested continuation digest is returned without typed memory", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.recordSession({
        root: t.root,
        sessionID: "ses_continue",
        topic: "memory continuity",
        summary: "Objective: finish memory v0. Next: verify recall fixture behavior.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const result = await MemoryRecall.search({
        root: t.root,
        query: "where were we",
        mode: "digest",
        sessionID: "ses_continue",
      })

      expect(result?.hits).toHaveLength(1)
      expect(result?.hits[0]?.type).toBe("digest")
      expect(result?.block).toContain("session=ses_continue")
    })
  })

  test("expected hit: typed memory beats weaker conflicting digest", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "release_notes_summary",
        text: "Release notes need Spanish summaries before reviewer handoff.",
      })
      await Memory.recordSession({
        root: t.root,
        sessionID: "ses_old_release_notes",
        topic: "release notes",
        summary: "Older release notes discussion said English summaries were enough.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const result = await MemoryRecall.search({ root: t.root, query: "release notes Spanish summary", limit: 5 })

      expect(result?.hits[0]?.type).toBe("typed")
      expect(result?.hits[0]?.text).toContain("release_notes_summary")
    })
  })

  test("expected hit: distinct digest survives dedupe against an overlapping typed hit", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "release_process",
        text: "Main is frozen for the release process.",
      })
      await Memory.recordSession({
        root: t.root,
        sessionID: "ses_freeze_date",
        topic: "release process",
        summary: "Release process freeze deadline set to April 3 with a new CI gate added.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const result = await MemoryRecall.search({ root: t.root, query: "release process freeze date", limit: 5 })

      // The digest shares the release/process anchor with the typed hit but carries net-new content
      // (freeze deadline, CI gate); it must not be suppressed as a restatement.
      expect(result?.block).toContain("session=ses_freeze_date")
      expect(result?.block).toContain("release_process")
    })
  })

  test("expected hit: camelCase identifier matches a split query term", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "profile_helper",
        text: "The getUserName helper returns the active profile.",
      })

      const result = await MemoryRecall.search({ root: t.root, query: "user" })

      expect(result?.block).toContain("getUserName")
    })
  })

  test("expected hit: suffix stemming bridges tests/test and ranking/rank", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "cli_runner",
        text: "Runs the acceptance tests and reports ranking.",
      })

      const result = await MemoryRecall.search({ root: t.root, query: "test rank" })

      expect(result?.block).toContain("cli_runner")
    })
  })

  test("expected miss: stopword-only overlap does not leak unrelated memory", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({ root: t.root, key: "unit_tests", text: "Run the unit tests before merge." })
      await Memory.remember({ root: t.root, key: "the_the_note", text: "The the the the the config value." })

      const result = await MemoryRecall.search({ root: t.root, query: "the tests" })

      expect(result?.block).toContain("unit_tests")
      expect(result?.block).not.toContain("the_the_note")
    })
  })

  test("expected miss: relevance floor drops weak single-token matches on the recall caller", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.apply({
        root: t.root,
        ops: [
          {
            action: "add",
            key: "deploy_release",
            text: "Deploy the release with the staging checklist and rollback plan.",
          },
          { action: "add", key: "unrelated_note", text: "The staging server needs a plan." },
        ],
      })

      const recall = await Memory.recall({ root: t.root, query: "deploy release staging checklist rollback" })

      expect(recall.result?.block).toContain("deploy_release")
      expect(recall.result?.block).not.toContain("unrelated_note")
    })
  })

  test("expected miss: oversized unrelated query does not leak memory", async () => {
    await use(async (t) => {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "cli_tests",
        text: "Run CLI tests from packages/opencode with bun test.",
      })

      const result = await MemoryRecall.search({ root: t.root, query: "zzzz ".repeat(2000), limit: 20 })

      expect(result).toBeUndefined()
    })
  })
})
