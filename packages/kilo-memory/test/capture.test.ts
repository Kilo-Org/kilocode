import { describe, expect, test } from "bun:test"
import {
  capturePlan,
  duplicateOps,
  fallbackDigest,
  guardReason,
  hasDurableDiff,
  mergeOps,
  notice,
  parseJson,
  parseOps,
  skipLine,
  summarizeDiffs,
  typedSchema,
  verifySkips,
  digestSchema,
} from "../src/capture/capture"
import { MemoryOperations } from "../src/capture/ops"
import { MemoryRedact } from "../src/capture/redact"

describe("memory capture parsing", () => {
  test("parses fenced json text from model output", () => {
    const parsed = parseJson(digestSchema, '```json\n{"topic":"repo setup","summary":"Run package tests."}\n```')

    expect(parsed).toEqual({ topic: "repo setup", summary: "Run package tests." })
  })

  test("maps consolidation operation names into deterministic memory operations", () => {
    const parsed = parseJson(
      typedSchema,
      JSON.stringify({
        operations: [
          { op: "upsert_project_fact", key: "repo_tests", value: "Run tests from packages/opencode." },
          {
            op: "upsert_project_decision",
            key: "file_store",
            value: "Keep memory v0 file-based before adding databases.",
          },
          { op: "upsert_project_constraint", key: "zod_only", value: "The memory package stays zod-only." },
          { op: "upsert_environment_fact", section: "tooling", key: "bun", value: "Use bun for package scripts." },
          { op: "append_correction", key: "root_tests", value: "Do not run bun test from the repo root." },
          { op: "remove_memory", query: "old_memory" },
          { op: "noop", key: "ignored", value: "ignored" },
        ],
        skipped: [{ reason: "duplicate", text: "already saved" }],
      }),
    )

    expect(parseOps(parsed)).toEqual([
      {
        action: "add",
        file: "project.md",
        section: "Facts",
        key: "repo_tests",
        text: "Run tests from packages/opencode.",
      },
      {
        action: "add",
        file: "project.md",
        section: "Decisions",
        key: "file_store",
        text: "Keep memory v0 file-based before adding databases.",
      },
      {
        action: "add",
        file: "project.md",
        section: "Constraints",
        key: "zod_only",
        text: "The memory package stays zod-only.",
      },
      {
        action: "add",
        file: "environment.md",
        section: "Tooling",
        key: "bun",
        text: "Use bun for package scripts.",
      },
      {
        action: "add",
        file: "corrections.md",
        section: "Corrections",
        key: "root_tests",
        text: "Do not run bun test from the repo root.",
      },
      { action: "remove", query: "old_memory" },
    ])
    expect(parsed.skipped).toEqual([{ reason: "duplicate", text: "already saved" }])
  })

  test("merges fallback typed operations without duplicates", () => {
    const ops = mergeOps([
      { action: "add", file: "environment.md", section: "Commands", key: "tests", text: "Run bun test." },
      { action: "add", file: "environment.md", section: "Commands", key: "tests", text: "Run bun test again." },
      { action: "remove", query: "stale" },
      { action: "remove", query: "stale" },
    ])

    expect(ops).toEqual([
      { action: "add", file: "environment.md", section: "Commands", key: "tests", text: "Run bun test." },
      { action: "remove", query: "stale" },
    ])
  })

  test("filters self-referential generated adds", () => {
    const fact = {
      action: "add",
      file: "project.md",
      section: "Facts",
      key: "memory_index",
      text: "Memory index records are rebuilt from project source files.",
    } satisfies MemoryOperations.Op
    const filtered = duplicateOps({
      items: [],
      skipped: [],
      ops: [
        {
          action: "add",
          file: "project.md",
          section: "Facts",
          key: "memory_echo",
          text: "Small model call-site behavior is already in project memory.",
        },
        {
          action: "add",
          file: "project.md",
          section: "Facts",
          key: "scope_review",
          text: "Config preference scope/write behavior was investigated.",
        },
        fact,
      ],
    })

    expect(filtered.ops).toEqual([fact])
    expect(filtered.skipped.map((item) => item.reason)).toEqual(["self_referential", "self_referential"])
    expect(MemoryOperations.reject(fact)).toBeUndefined()
  })

  test("filters instruction provenance generated adds", () => {
    const fact = {
      action: "add",
      file: "project.md",
      section: "Facts",
      key: "repo_test_rule",
      text: "Root AGENTS.md says to run package-level tests instead of root bun test.",
    } satisfies MemoryOperations.Op
    const filtered = duplicateOps({
      items: [],
      skipped: [],
      ops: [
        {
          action: "add",
          file: "project.md",
          section: "Facts",
          key: "instruction_sources",
          text: "Sources: system/developer instructions, AGENTS.md, packages/opencode/AGENTS.md, and ~/.claude/CLAUDE.md.",
        },
        {
          action: "add",
          file: "project.md",
          section: "Facts",
          key: "user_context",
          text: "~/.claude/CLAUDE.md is user-level context for concise replies.",
        },
        fact,
      ],
    })

    expect(filtered.ops).toEqual([fact])
    expect(filtered.skipped.map((item) => item.reason)).toEqual(["out_of_scope", "out_of_scope"])
  })

  test("parses project-only skip reasons", () => {
    const parsed = parseJson(
      typedSchema,
      JSON.stringify({
        operations: [{ op: "noop" }],
        skipped: [
          { reason: "out_of_scope", text: "User prefers concise commit messages." },
          { reason: "self_referential", text: "Existing memory already tracks the test command." },
        ],
      }),
    )

    expect(parseOps(parsed)).toEqual([])
    expect(parsed.skipped.map((item) => item.reason)).toEqual(["out_of_scope", "self_referential"])
    expect(skipLine([parsed.skipped[0]!])).toBe("reason=out_of_scope")
  })

  test("plans capture cadence from a state table", () => {
    const base = {
      summary: "User: continue Result: updated code",
      echo: false,
      durable: false,
      priorTime: 0,
      now: 1_000,
      minIntervalMs: 500,
      lastConsolidatedAt: undefined,
      autoConsolidate: true,
    }
    const cases = [
      {
        name: "expected work: completed turn schedules digest and typed capture",
        input: base,
        expected: { session: true, digestDue: true, typedCall: true, typedWork: true, skipReason: undefined },
      },
      {
        name: "expected idle flush: completed turn inside interval skips now",
        input: { ...base, priorTime: 900, lastConsolidatedAt: 900 },
        expected: { digestDue: false, typedCall: false, skipReason: "interval", idleFlush: true },
      },
      {
        name: "expected work: bypass interval lets idle flush run typed capture",
        input: { ...base, priorTime: 900, lastConsolidatedAt: 900, bypassInterval: true },
        expected: { digestDue: false, typedCall: true, skipReason: undefined, idleFlush: false },
      },
      {
        name: "expected skip: recall echo with no durable diff",
        input: { ...base, echo: true },
        expected: { session: false, digestDue: false, typedCall: false, skipReason: "memory_echo" },
      },
      {
        name: "expected work: recall-assisted durable answer is modeled as non-echo by caller",
        input: { ...base, durable: true },
        expected: { session: true, digestDue: true, typedCall: true, skipReason: undefined },
      },
      {
        name: "expected skip: interrupted turn",
        input: { ...base, reason: "interrupted" as const, durable: true },
        expected: { completed: false, session: false, digestDue: false, typedCall: false, skipReason: "no_work" },
      },
      {
        name: "expected skip: errored turn",
        input: { ...base, reason: "error" as const },
        expected: { completed: false, session: false, digestDue: false, typedCall: false, skipReason: "no_work" },
      },
      {
        name: "expected skip: auto consolidation disabled",
        input: { ...base, autoConsolidate: false },
        expected: { session: false, digestDue: false, typedCall: false, typedWork: false, skipReason: "no_work" },
      },
      {
        name: "expected skip: no summary means no work",
        input: { ...base, summary: "" },
        expected: { session: false, digestDue: false, typedCall: false, typedWork: false, skipReason: "no_work" },
      },
    ]

    for (const item of cases) {
      expect(capturePlan(item.input), item.name).toMatchObject(item.expected)
    }
  })

  test("summarizes durable diffs and fallback digests", () => {
    const diffs = [
      { file: "src/index.ts", status: "modified", additions: 1, deletions: 1 },
      { file: "README.md", status: "modified", additions: 1, deletions: 0 },
    ]

    expect(hasDurableDiff(diffs)).toBe(true)
    expect(hasDurableDiff([{ file: "docs/setup.md", additions: 1, deletions: 0 }])).toBe(true)
    expect(hasDurableDiff([{ file: ".kilo/rules.md", additions: 1, deletions: 0 }])).toBe(true)
    expect(hasDurableDiff([{ file: "src/plain.ts", additions: 1, deletions: 0 }])).toBe(false)
    expect(summarizeDiffs(diffs)).toContain("modified README.md +1 -0")
    expect(fallbackDigest({ prior: "Earlier state.", summary: "New state.", max: 80 })).toContain("Latest: New state.")
  })

  test("verifies duplicate skips and operation duplicates", () => {
    const items = [{ id: "project.md:repo_tests", text: "repo_tests Run memory tests from packages/opencode." }]
    const verified = verifySkips({
      items,
      skipped: [
        { reason: "duplicate", text: "Run memory tests from packages/opencode." },
        { reason: "duplicate", text: "New durable workflow preference." },
      ],
    })
    const deduped = duplicateOps({
      items,
      skipped: verified.skipped,
      ops: [
        { action: "add", file: "project.md", section: "Facts", key: "repo_tests", text: "Run memory tests." },
        { action: "add", file: "project.md", section: "Facts", key: "new_preference", text: "New durable workflow preference." },
      ],
    })

    expect(verified.skipped[0]?.duplicateOf).toBe("project.md:repo_tests")
    expect(verified.rescued).toEqual([])
    expect(verified.skipped).toContainEqual({ reason: "unsupported", text: "New durable workflow preference." })
    expect(deduped.ops).toEqual([
      { action: "add", file: "project.md", section: "Facts", key: "new_preference", text: "New durable workflow preference." },
    ])
    expect(deduped.skipped.some((item) => item.duplicateOf === "project.md:repo_tests")).toBe(true)
  })

  test("builds capture notices and guard summaries", () => {
    const ops = [{ action: "add", file: "environment.md", section: "Commands", key: "tests", text: "Run bun test." }] as const

    expect(notice({ count: 1, ops: [...ops], skipped: [], tokens: 12 })).toMatchObject({
      type: "saved",
      message: "Memory saved · environment.md:tests",
      files: ["environment.md"],
    })
    expect(notice({ count: 0, ops: [], skipped: [{ reason: "duplicate", duplicateOf: "project.md:tests" }], tokens: 3 }))
      .toMatchObject({ type: "skipped", skippedCount: 1 })
    expect(skipLine([{ reason: "duplicate", duplicateOf: "project.md:tests" }])).toBe(
      "reason=duplicate duplicateOf=project.md:tests",
    )
    expect(guardReason("429 too many requests")).toBe("rate_limit_guard")
    expect(guardReason("billing credits exhausted")).toBe("quota_guard")
  })

  test("redacts common secret token shapes", () => {
    const github = "ghp_abcdefghijklmnopqrstuvwxyz1234567890"
    const google = "AIzaabcdefghijklmnopqrstuvwxyz123456789"
    const jwt = "eyJabcdefghijklmnopqrstuvwxyz.eyJmnopqrstuvwxyz12345.signaturevalue12345"
    const bearer = "Bearer abcdefghijklmnopqrstuvwxyz123456"
    const text = [
      `github=${github}`,
      `google=${google}`,
      `jwt=${jwt}`,
      `Authorization: ${bearer}`,
      "client_secret=super-secret-value",
      "access_key=super-secret-value",
      "refresh_token=abcdefghijklmnopqrstuvwxyz",
      'password="two words"',
      "DATABASE_URL=postgres://alice:hunter2@host/db",
    ].join("\n")
    const redacted = MemoryRedact.text(text)

    expect(MemoryRedact.has(text)).toBe(true)
    expect(redacted).not.toContain(github)
    expect(redacted).not.toContain(google)
    expect(redacted).not.toContain(jwt)
    expect(redacted).not.toContain(bearer)
    expect(redacted.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(9)
    expect(redacted).not.toContain("two words")
    expect(redacted).not.toContain("hunter2")
    expect(MemoryRedact.value({ private_key: "abc", credential: "def", auth: "ghi" })).toEqual({
      private_key: "[redacted]",
      credential: "[redacted]",
      auth: "[redacted]",
    })
  })

  test("redacts URI userinfo credentials", () => {
    const cases = [
      ["postgres://alice:hunter2@db.local/app", "postgres://[redacted]@db.local/app", "hunter2"],
      ["postgresql://alice:p%40ss@db.local/app", "postgresql://[redacted]@db.local/app", "p%40ss"],
      ["mongodb+srv://user:secret@cluster.mongodb.net/app", "mongodb+srv://[redacted]@cluster.mongodb.net/app", "secret"],
      ["redis://:cache-secret@localhost:6379/0", "redis://[redacted]@localhost:6379/0", "cache-secret"],
      ["https://user:pass@example.com/path", "https://[redacted]@example.com/path", "pass"],
    ] as const

    for (const item of cases) {
      const redacted = MemoryRedact.text(item[0])
      expect(MemoryRedact.has(item[0]), item[0]).toBe(true)
      expect(redacted).toBe(item[1])
      expect(redacted).not.toContain(item[2])
    }

    // Unknown/non-allowlisted scheme: parsing, not an enumerated list, decides.
    expect(MemoryRedact.text("clickhouse://svc:topsecret@host:9000/db")).toBe("clickhouse://[redacted]@host:9000/db")

    // Fail closed on any userinfo: a bare user@host (no colon) may still be a token.
    expect(MemoryRedact.has("https://token@host/path")).toBe(true)
    expect(MemoryRedact.text("https://token@host/path")).toBe("https://[redacted]@host/path")

    // Multiple URIs embedded in prose: each userinfo is redacted, surrounding text preserved.
    expect(MemoryRedact.text("primary postgres://u:p@h1/a then cache redis://:s@h2/0 done")).toBe(
      "primary postgres://[redacted]@h1/a then cache redis://[redacted]@h2/0 done",
    )

    // Malformed URL the parser rejects must still redact via the raw-segment fallback.
    const malformed = "postgres://user:leaked@[bad"
    expect(MemoryRedact.has(malformed)).toBe(true)
    expect(MemoryRedact.text(malformed)).not.toContain("leaked")

    // @ in the path or query with no userinfo must not be touched (no false positives).
    expect(MemoryRedact.has("https://example.com/a:b@c")).toBe(false)
    expect(MemoryRedact.text("https://example.com/a:b@c")).toBe("https://example.com/a:b@c")
    expect(MemoryRedact.text("https://example.com/p?to=a@b.com")).toBe("https://example.com/p?to=a@b.com")

    // has() and text() must agree: anything has() flags is actually scrubbed by text().
    for (const item of [...cases.map((c) => c[0]), malformed, "no secrets here", "https://example.com/a:b@c"]) {
      if (MemoryRedact.has(item)) expect(MemoryRedact.text(item), item).not.toBe(item)
    }
  })
})
