import { test, expect, describe } from "bun:test"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { SessionID } from "../../../src/session/schema"
import { Instance } from "../../../src/project/instance"
import { NotFoundError } from "../../../src/storage/db"
import { tmpdir } from "../../fixture/fixture"

describe("saveAlwaysRules", () => {
  test("approved rules auto-allow future requests", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = Permission.ask({
          id: PermissionID.make("permission_1"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *", "npm install"] },
          always: ["npm install *"],
          ruleset: [],
        })

        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_1"),
          approvedAlways: ["npm install"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_1"), reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        const result = await Permission.ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()
      },
    })
  })

  test("denied rules auto-deny future requests", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = Permission.ask({
          id: PermissionID.make("permission_2"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: { rules: ["rm *", "rm -rf /"] },
          always: ["rm *"],
          ruleset: [],
        })

        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_2"),
          deniedAlways: ["rm -rf /"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_2"), reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        await expect(
          Permission.ask({
            sessionID: SessionID.make("session_test"),
            permission: "bash",
            patterns: ["rm -rf /"],
            metadata: {},
            always: [],
            ruleset: [],
          }),
        ).rejects.toBeInstanceOf(Permission.DeniedError)
      },
    })
  })

  test("throws for unknown request ID", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          Permission.saveAlwaysRules({
            requestID: PermissionID.make("permission_nonexistent"),
            approvedAlways: ["npm install"],
          }),
        ).rejects.toBeInstanceOf(NotFoundError)
      },
    })
  })

  test("ignores patterns not in metadata.rules or always", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = Permission.ask({
          id: PermissionID.make("permission_3"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *", "npm install"] },
          always: ["npm install *"],
          ruleset: [],
        })

        // "curl" is not in metadata.rules or always — should be silently ignored
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_3"),
          approvedAlways: ["npm install", "curl http://evil.com"],
        })

        await Permission.reply({ requestID: PermissionID.make("permission_3"), reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // npm install was in rules — auto-allowed
        const result = await Permission.ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()

        // curl was NOT in rules — still requires permission
        const curlPromise = Permission.ask({
          id: PermissionID.make("permission_curl"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["curl http://evil.com"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_curl"), reply: "reject" })
        await expect(curlPromise).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })

  test("accepts patterns from always array (non-bash tools)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = Permission.ask({
          id: PermissionID.make("permission_nonbash"),
          sessionID: SessionID.make("session_test"),
          permission: "read",
          patterns: ["src/main.ts"],
          metadata: {},
          always: ["*"],
          ruleset: [],
        })

        // "*" is in always — should be accepted even without metadata.rules
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_nonbash"),
          approvedAlways: ["*"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_nonbash"), reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // "*" wildcard should auto-allow any read
        const result = await Permission.ask({
          sessionID: SessionID.make("session_test"),
          permission: "read",
          patterns: ["any/file.ts"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()
      },
    })
  })

  test("accepts hierarchy patterns from metadata.rules", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = Permission.ask({
          id: PermissionID.make("permission_4"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install lodash"],
          metadata: { rules: ["npm *", "npm install *", "npm install lodash"] },
          always: ["npm install *"],
          ruleset: [],
        })

        // Approve the broadest hierarchy level
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_4"),
          approvedAlways: ["npm *"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_4"), reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // "npm *" wildcard should auto-allow any npm command
        const result = await Permission.ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()
      },
    })
  })

  test("mixed allow/deny preserves metadata.rules order", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = Permission.ask({
          id: PermissionID.make("permission_5"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install lodash"],
          // rules ordered broad → specific
          metadata: { rules: ["npm *", "npm install *"] },
          always: ["npm install *"],
          ruleset: [],
        })

        // Deny broad, allow specific — specific should win
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_5"),
          approvedAlways: ["npm install *"],
          deniedAlways: ["npm *"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_5"), reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // "npm install foo" matches both rules; "npm install *" (allow) comes
        // after "npm *" (deny) in metadata.rules order, so allow wins
        const result = await Permission.ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install foo"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()
      },
    })
  })

  test("deny broad + allow specific: specific allow wins", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = Permission.ask({
          id: PermissionID.make("permission_6"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["git log --oneline"],
          metadata: { rules: ["git *", "git log *"] },
          always: ["git log *"],
          ruleset: [],
        })

        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_6"),
          approvedAlways: ["git log *"],
          deniedAlways: ["git *"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_6"), reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // "git log --oneline" should be allowed (specific allow after broad deny)
        const allowed = await Permission.ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["git log --oneline"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(allowed).toBeUndefined()

        // "git status" should be denied (only matches broad deny)
        await expect(
          Permission.ask({
            sessionID: SessionID.make("session_test"),
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
          }),
        ).rejects.toBeInstanceOf(Permission.DeniedError)
      },
    })
  })

  test("rules not in metadata.rules are silently ignored", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = Permission.ask({
          id: PermissionID.make("permission_7"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        })

        // "curl" is not in metadata.rules — should be silently ignored
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_7"),
          approvedAlways: ["npm *", "curl *"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_7"), reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // curl should still require permission (not auto-allowed)
        const curlPromise = Permission.ask({
          id: PermissionID.make("permission_curl2"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["curl http://example.com"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_curl2"), reply: "reject" })
        await expect(curlPromise).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })

  test("auto-resolves pending permission from sibling session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Subagent A asks for bash permission
        const askA = Permission.ask({
          id: PermissionID.make("permission_a"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        })

        // Subagent B asks for the same permission (different session)
        const askB = Permission.ask({
          id: PermissionID.make("permission_b"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // User approves "npm *" on subagent A's permission
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_a"),
          approvedAlways: ["npm *"],
        })

        // Subagent B should auto-resolve because "npm test" matches "npm *"
        await Permission.reply({ requestID: PermissionID.make("permission_a"), reply: "once" })
        await expect(askA).resolves.toBeUndefined()
        await expect(askB).resolves.toBeUndefined()
      },
    })
  })

  test("auto-resolves multiple pending permissions from different sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askA = Permission.ask({
          id: PermissionID.make("permission_a2"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["npm install lodash"],
          metadata: { rules: ["npm *", "npm install *"] },
          always: ["npm *"],
          ruleset: [],
        })

        const askB = Permission.ask({
          id: PermissionID.make("permission_b2"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["npm run build"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        const askC = Permission.ask({
          id: PermissionID.make("permission_c2"),
          sessionID: SessionID.make("session_c"),
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // Approve "npm *" on session A — should auto-resolve B and C
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_a2"),
          approvedAlways: ["npm *"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_a2"), reply: "once" })

        await expect(askA).resolves.toBeUndefined()
        await expect(askB).resolves.toBeUndefined()
        await expect(askC).resolves.toBeUndefined()
      },
    })
  })

  test("does not auto-resolve pending permission with non-matching pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askA = Permission.ask({
          id: PermissionID.make("permission_a3"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        })

        // Subagent B asks for a different command
        const askB = Permission.ask({
          id: PermissionID.make("permission_b3"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["curl http://example.com"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // Approve "npm *" — should NOT resolve B (curl doesn't match npm *)
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_a3"),
          approvedAlways: ["npm *"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_a3"), reply: "once" })
        await expect(askA).resolves.toBeUndefined()

        // B should still be pending — reject it to clean up
        await Permission.reply({ requestID: PermissionID.make("permission_b3"), reply: "reject" })
        await expect(askB).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })

  test("does not auto-resolve the request being replied to", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askA = Permission.ask({
          id: PermissionID.make("permission_a4"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        })

        // Save rules but don't reply yet — the request itself should not be auto-resolved
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_a4"),
          approvedAlways: ["npm *"],
        })

        // The original request should still be pending (needs explicit reply)
        const pending = await Permission.list()
        expect(pending.some((p) => String(p.id) === "permission_a4")).toBe(true)

        await Permission.reply({ requestID: PermissionID.make("permission_a4"), reply: "once" })
        await expect(askA).resolves.toBeUndefined()
      },
    })
  })

  test("auto-rejects pending permission from sibling session when denied", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askA = Permission.ask({
          id: PermissionID.make("permission_a5"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["git log --oneline -5"],
          metadata: { rules: ["git *", "git log *"] },
          always: ["git log *"],
          ruleset: [],
        })

        const askB = Permission.ask({
          id: PermissionID.make("permission_b5"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["git log --oneline -10"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // User denies "git log *" on subagent A
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_a5"),
          deniedAlways: ["git log *"],
        })

        // Subagent B should auto-reject because "git log --oneline -10" matches denied "git log *"
        await Permission.reply({ requestID: PermissionID.make("permission_a5"), reply: "once" })
        await expect(askA).resolves.toBeUndefined()
        await expect(askB).rejects.toBeInstanceOf(Permission.DeniedError)
      },
    })
  })

  test("multi-pattern: auto-resolves when new rule covers blocking pattern and ruleset covers the rest", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Subagent B has "git status && npm install" — two patterns.
        // Its ruleset already allows "npm install" but "git status" is "ask".
        const askB = Permission.ask({
          id: PermissionID.make("permission_multi_b"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["git status", "npm install"],
          metadata: {},
          always: [],
          ruleset: [
            { permission: "bash", pattern: "*", action: "ask" },
            { permission: "bash", pattern: "npm install", action: "allow" },
          ],
        })

        // Subagent A gets "git status" approved
        const askA = Permission.ask({
          id: PermissionID.make("permission_multi_a"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["git status"],
          metadata: { rules: ["git *"] },
          always: ["git *"],
          ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
        })

        // User approves "git *" on subagent A
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_multi_a"),
          approvedAlways: ["git *"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_multi_a"), reply: "once" })

        // B should auto-resolve: "git status" covered by new rule, "npm install" covered by original ruleset
        await expect(askA).resolves.toBeUndefined()
        await expect(askB).resolves.toBeUndefined()
      },
    })
  })

  test("multi-pattern: stays pending when new rule covers one pattern but ruleset doesn't cover the other", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Subagent B has "git status && curl http://evil.com" — two patterns.
        // Neither is allowed by the ruleset.
        const askB = Permission.ask({
          id: PermissionID.make("permission_multi_b2"),
          sessionID: SessionID.make("session_b"),
          permission: "bash",
          patterns: ["git status", "curl http://evil.com"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
        })

        const askA = Permission.ask({
          id: PermissionID.make("permission_multi_a2"),
          sessionID: SessionID.make("session_a"),
          permission: "bash",
          patterns: ["git status"],
          metadata: { rules: ["git *"] },
          always: ["git *"],
          ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
        })

        // User approves "git *" — covers "git status" but NOT "curl"
        await Permission.saveAlwaysRules({
          requestID: PermissionID.make("permission_multi_a2"),
          approvedAlways: ["git *"],
        })
        await Permission.reply({ requestID: PermissionID.make("permission_multi_a2"), reply: "once" })
        await expect(askA).resolves.toBeUndefined()

        // B should still be pending (curl not covered)
        const pending = await Permission.list()
        expect(pending.some((p) => String(p.id) === "permission_multi_b2")).toBe(true)

        await Permission.reply({ requestID: PermissionID.make("permission_multi_b2"), reply: "reject" })
        await expect(askB).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })
})
