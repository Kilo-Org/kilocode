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
  salvageTyped,
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

  test("salvages valid ops from a partially malformed typed batch with model preamble", () => {
    const tooLong = "x".repeat(2_100)
    const parsed = salvageTyped(
      "Here is the JSON you asked for:\n" +
        `{"operations":[` +
        `{"op":"upsert_project_fact","key":"good_one","value":"Keep this fact."},` +
        `{"op":"not_a_real_op","key":"nope","value":"unknown op is salvaged"},` +
        `{"op":"upsert_project_fact","key":"too_long","value":"${tooLong}"},` +
        `{"op":"upsert_project_decision","key":"good_two","value":"Keep this decision."}` +
        `],"skipped":[{"reason":"duplicate","text":"already saved"}]}`,
    )

    // The two well-formed ops survive; the unknown op and the over-length value are salvaged, not fatal.
    expect(parseOps(parsed).map((op) => (op.action === "add" ? op.key : op.action))).toEqual(["good_one", "good_two"])
    expect(parsed.skipped.filter((item) => item.reason === "unsupported")).toHaveLength(2)
    expect(parsed.skipped.some((item) => item.reason === "duplicate")).toBe(true)
  })

  test("truncates typed batches beyond the op cap instead of failing", () => {
    const ops = Array.from(
      { length: 20 },
      (_, idx) => `{"op":"upsert_project_fact","key":"k_${idx}","value":"Fact ${idx} body."}`,
    ).join(",")
    const parsed = salvageTyped(`{"operations":[${ops}],"skipped":[]}`)

    expect(parsed.operations).toHaveLength(16)
  })

  test("reconcile supersedes and honors only exact-key removes", () => {
    const keys = new Set(["project.md:Facts:stale_fact", "stale_fact", "kept_fact"])
    const reconciled = MemoryOperations.reconcile({
      keys,
      ops: [
        // Add updating an existing key → keep the add.
        { action: "add", file: "project.md", section: "Facts", key: "kept_fact", text: "Updated value." },
        // Remove superseded by a same-batch add on the same key → dropped (the add updates it).
        { action: "add", file: "project.md", section: "Facts", key: "replaced", text: "New value." },
        { action: "remove", query: "replaced" },
        // Exact existing key with no replacing add → kept as a bounded removal.
        { action: "remove", query: "stale_fact" },
        // Fuzzy query that matches no existing key → dropped (hard removes stay explicit-only).
        { action: "remove", query: "something the model paraphrased" },
      ],
    })

    expect(reconciled.ops.map((op) => op.key)).toEqual(["kept_fact", "replaced"])
    expect(reconciled.removes).toEqual([{ action: "remove", query: "stale_fact" }])
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
        name: "expected work: recall echo still runs typed capture when user text is substantive",
        input: { ...base, echo: true, echoTypedAllowed: true },
        expected: { session: false, digestDue: false, typedCall: true, typedWork: true, skipReason: undefined },
      },
      {
        name: "expected work: recall-assisted durable answer is modeled as non-echo by caller",
        input: { ...base, durable: true },
        expected: { session: true, digestDue: true, typedCall: true, skipReason: undefined },
      },
      {
        name: "expected skip: interrupted turn still schedules a non-LLM fallback digest",
        input: { ...base, reason: "interrupted" as const, durable: true },
        expected: {
          completed: false,
          session: false,
          digestDue: false,
          typedCall: false,
          fallbackDigest: true,
          skipReason: "no_work",
        },
      },
      {
        name: "expected skip: errored turn still schedules a non-LLM fallback digest",
        input: { ...base, reason: "error" as const },
        expected: {
          completed: false,
          session: false,
          digestDue: false,
          typedCall: false,
          fallbackDigest: true,
          skipReason: "no_work",
        },
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
    // P1.5: a substantial edit is durable regardless of language — no JS/TS extension allowlist.
    expect(hasDurableDiff([{ file: "src/service.py", additions: 20, deletions: 0 }])).toBe(true)
    expect(hasDurableDiff([{ file: "internal/server/main.go", additions: 12, deletions: 10 }])).toBe(true)
    expect(hasDurableDiff([{ file: "src/lib.rs", additions: 5, deletions: 5 }])).toBe(false)
    expect(summarizeDiffs(diffs)).toContain("modified README.md +1 -0")
    expect(fallbackDigest({ prior: "Earlier state.", summary: "New state.", max: 80 })).toContain("Latest: New state.")
  })

  test("verifies duplicate skips and operation duplicates", () => {
    const items = [
      {
        id: "project.md:Facts:repo_tests",
        file: "project.md" as const,
        section: "Facts",
        key: "repo_tests",
        text: "repo_tests Run memory tests from packages/opencode.",
      },
    ]
    const verified = verifySkips({
      items,
      skipped: [
        // Fully scoped to the stored entry → confirmed.
        { reason: "duplicate", text: "Run memory tests from packages/opencode.", file: "project.md", section: "Facts" },
        // Unscoped → unverified regardless of any text overlap.
        { reason: "duplicate", text: "New durable workflow preference." },
      ],
    })
    const deduped = duplicateOps({
      items,
      skipped: verified.skipped,
      ops: [
        // Same file/section/key as an existing entry, changed value → an upsert update, not a duplicate.
        { action: "add", file: "project.md", section: "Facts", key: "repo_tests", text: "Run memory tests." },
        {
          action: "add",
          file: "project.md",
          section: "Facts",
          key: "new_preference",
          text: "New durable workflow preference.",
        },
      ],
    })

    expect(verified.skipped[0]?.duplicateOf).toBe("project.md:Facts:repo_tests")
    expect(verified.skipped).toContainEqual({ reason: "unsupported", text: "New durable workflow preference." })
    // The exact-key upsert is kept (routed to apply as an update); the new fact is kept too.
    expect(deduped.ops).toEqual([
      { action: "add", file: "project.md", section: "Facts", key: "repo_tests", text: "Run memory tests." },
      {
        action: "add",
        file: "project.md",
        section: "Facts",
        key: "new_preference",
        text: "New durable workflow preference.",
      },
    ])
    // The exact-key upsert produces no NEW op-level duplicate skip; the only entry pointing at
    // repo_tests is the model's own confirmed duplicate claim carried through verifySkips.
    expect(deduped.skipped.filter((item) => item.duplicateOf === "project.md:Facts:repo_tests")).toHaveLength(1)
  })

  test("does not pre-skip similar operations from different memory scopes", () => {
    const filtered = duplicateOps({
      items: [
        {
          id: "corrections.md:Corrections:repo_tests",
          file: "corrections.md",
          section: "Corrections",
          key: "repo_tests",
          text: "repo_tests Run memory tests from packages/opencode.",
        },
      ],
      skipped: [],
      ops: [
        {
          action: "add",
          file: "project.md",
          section: "Facts",
          key: "repo_tests",
          text: "Run memory tests from packages/opencode.",
        },
      ],
    })

    expect(filtered.ops).toHaveLength(1)
    expect(filtered.skipped).toEqual([])
  })

  test("scopes model-reported duplicate skips to the claimed file/section", () => {
    const items = [
      {
        id: "corrections.md:Corrections:repo_tests",
        file: "corrections.md" as const,
        section: "Corrections",
        key: "repo_tests",
        text: "repo_tests Run memory tests from packages/opencode.",
      },
    ]
    const verified = verifySkips({
      items,
      skipped: [
        // Claims a duplicate in project.md/Facts, but the only match lives in corrections.md →
        // unconfirmed, downgraded to advisory instead of confirmed cross-scope.
        {
          reason: "duplicate",
          text: "Run memory tests from packages/opencode.",
          file: "project.md",
          section: "Facts",
        },
        // Same text, correctly scoped to where the entry actually lives → confirmed.
        {
          reason: "duplicate",
          text: "Run memory tests from packages/opencode.",
          file: "corrections.md",
          section: "Corrections",
        },
      ],
    })

    expect(verified.skipped[0]).toMatchObject({ reason: "unsupported" })
    expect(verified.skipped[1]).toMatchObject({
      reason: "duplicate",
      duplicateOf: "corrections.md:Corrections:repo_tests",
    })
  })

  test("does not confirm a duplicate skip scoped to a file without a section", () => {
    const items = [
      {
        id: "project.md:Decisions:repo_tests",
        file: "project.md" as const,
        section: "Decisions",
        key: "repo_tests",
        text: "repo_tests Run memory tests from packages/opencode.",
      },
    ]
    const verified = verifySkips({
      items,
      skipped: [
        // Claims project.md but not the section; the only match lives in Decisions. Confirming would
        // risk a cross-section false positive, so it must downgrade to advisory.
        { reason: "duplicate", text: "Run memory tests from packages/opencode.", file: "project.md" },
      ],
    })

    expect(verified.skipped[0]).toEqual({
      reason: "unsupported",
      text: "Run memory tests from packages/opencode.",
    })
  })

  test("builds capture notices and guard summaries", () => {
    const ops = [
      { action: "add", file: "environment.md", section: "Commands", key: "tests", text: "Run bun test." },
    ] as const

    expect(notice({ count: 1, ops: [...ops], skipped: [], tokens: 12 })).toMatchObject({
      type: "saved",
      message: "Memory saved · environment.md:tests",
      files: ["environment.md"],
    })
    expect(
      notice({ count: 0, ops: [], skipped: [{ reason: "duplicate", duplicateOf: "project.md:tests" }], tokens: 3 }),
    ).toMatchObject({ type: "skipped", skippedCount: 1 })
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
      [
        "mongodb+srv://user:secret@cluster.mongodb.net/app",
        "mongodb+srv://[redacted]@cluster.mongodb.net/app",
        "secret",
      ],
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

  test("assignment redaction avoids prose false positives but still catches real secrets", () => {
    // P1.6: keyword-boundary + secret-shaped-value guards. These prose phrases must NOT redact.
    const clean = [
      "author: Jane",
      "auth_mode=none",
      "the token expiry is 1h",
      "secret: enabled",
      "password: required",
      "authored=today",
      "tokenizer=fast",
    ]
    for (const item of clean) {
      expect(MemoryRedact.has(item), item).toBe(false)
      expect(MemoryRedact.text(item), item).toBe(item)
    }

    // Real secrets (incl. compound underscore keys and short-but-entropic values) still redact.
    // A strong keyword assigned with `=` redacts even a low-entropy all-letter value.
    const secrets = [
      "password=hunter2",
      "password=hunterx",
      "client_secret=super-secret-value",
      "refresh_token=abcdefghijklmnopqrstuvwxyz",
      "api_key=sk-abcdefghijklmnopqrstuvwxyz",
    ]
    for (const item of secrets) {
      expect(MemoryRedact.has(item), item).toBe(true)
      expect(MemoryRedact.text(item), item).toContain("[redacted]")
    }
  })

  test("allowlists git clone-URL userinfo but still redacts credentialed URIs", () => {
    // P1.6: `git@` (no password) is the conventional clone user, not a secret.
    for (const item of ["ssh://git@github.com/org/repo.git", "https://git@github.com/org/repo.git"]) {
      expect(MemoryRedact.has(item), item).toBe(false)
      expect(MemoryRedact.text(item), item).toBe(item)
    }
    // A password on the git user is still a credential.
    expect(MemoryRedact.has("ssh://git:secret@github.com/org/repo.git")).toBe(true)
    expect(MemoryRedact.text("ssh://git:secret@github.com/org/repo.git")).not.toContain("secret")
  })

  test("rejects self-referential/provenance patterns only as whole values, keeping real facts", () => {
    // P1.9: single meta clause is still rejected...
    expect(MemoryOperations.reject({ text: "Config preference scope/write behavior was investigated." })).toMatchObject(
      { reason: "self_referential" },
    )
    // ...but a real fact that merely ends a later clause with "was reviewed" survives.
    expect(
      MemoryOperations.reject({ text: "Refactored auth in src/auth.ts. The retry path was reviewed." }),
    ).toBeUndefined()

    // A statement whose subject IS the source file is provenance...
    expect(MemoryOperations.reject({ text: "~/.claude/CLAUDE.md is user-level context for concise replies." })).toMatchObject(
      { reason: "out_of_scope" },
    )
    // ...but a fact that merely cites the file mid-sentence is kept.
    expect(
      MemoryOperations.reject({ text: "Run tests from packages/opencode per the rule in .claude/claude.md." }),
    ).toBeUndefined()
  })
})
