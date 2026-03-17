import { test, expect, describe } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { NotFoundError } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

describe("saveAlwaysRules", () => {
  test("approved rules auto-allow future requests", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = PermissionNext.ask({
          id: "permission_1",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *", "npm install"] },
          always: ["npm install *"],
          ruleset: [],
        })

        await PermissionNext.saveAlwaysRules({ requestID: "permission_1", approvedAlways: ["npm install"] })
        await PermissionNext.reply({ requestID: "permission_1", reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        const result = await PermissionNext.ask({
          sessionID: "session_test",
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
        const askPromise = PermissionNext.ask({
          id: "permission_2",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: { rules: ["rm *", "rm -rf /"] },
          always: ["rm *"],
          ruleset: [],
        })

        await PermissionNext.saveAlwaysRules({ requestID: "permission_2", deniedAlways: ["rm -rf /"] })
        await PermissionNext.reply({ requestID: "permission_2", reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        await expect(
          PermissionNext.ask({
            sessionID: "session_test",
            permission: "bash",
            patterns: ["rm -rf /"],
            metadata: {},
            always: [],
            ruleset: [],
          }),
        ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
      },
    })
  })

  test("throws for unknown request ID", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          PermissionNext.saveAlwaysRules({ requestID: "permission_nonexistent", approvedAlways: ["npm install"] }),
        ).rejects.toBeInstanceOf(NotFoundError)
      },
    })
  })

  test("ignores patterns not in metadata.rules or always", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = PermissionNext.ask({
          id: "permission_3",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *", "npm install"] },
          always: ["npm install *"],
          ruleset: [],
        })

        // "curl" is not in metadata.rules or always — should be silently ignored
        await PermissionNext.saveAlwaysRules({
          requestID: "permission_3",
          approvedAlways: ["npm install", "curl http://evil.com"],
        })

        await PermissionNext.reply({ requestID: "permission_3", reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // npm install was in rules — auto-allowed
        const result = await PermissionNext.ask({
          sessionID: "session_test",
          permission: "bash",
          patterns: ["npm install"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(result).toBeUndefined()

        // curl was NOT in rules — still requires permission
        const curlPromise = PermissionNext.ask({
          id: "permission_curl",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["curl http://evil.com"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        await PermissionNext.reply({ requestID: "permission_curl", reply: "reject" })
        await expect(curlPromise).rejects.toBeInstanceOf(PermissionNext.RejectedError)
      },
    })
  })

  test("accepts patterns from always array (non-bash tools)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = PermissionNext.ask({
          id: "permission_nonbash",
          sessionID: "session_test",
          permission: "read",
          patterns: ["src/main.ts"],
          metadata: {},
          always: ["*"],
          ruleset: [],
        })

        // "*" is in always — should be accepted even without metadata.rules
        await PermissionNext.saveAlwaysRules({ requestID: "permission_nonbash", approvedAlways: ["*"] })
        await PermissionNext.reply({ requestID: "permission_nonbash", reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // "*" wildcard should auto-allow any read
        const result = await PermissionNext.ask({
          sessionID: "session_test",
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
        const askPromise = PermissionNext.ask({
          id: "permission_4",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["npm install lodash"],
          metadata: { rules: ["npm *", "npm install *", "npm install lodash"] },
          always: ["npm install *"],
          ruleset: [],
        })

        // Approve the broadest hierarchy level
        await PermissionNext.saveAlwaysRules({ requestID: "permission_4", approvedAlways: ["npm *"] })
        await PermissionNext.reply({ requestID: "permission_4", reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // "npm *" wildcard should auto-allow any npm command
        const result = await PermissionNext.ask({
          sessionID: "session_test",
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
        const askPromise = PermissionNext.ask({
          id: "permission_5",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["npm install lodash"],
          // rules ordered broad → specific
          metadata: { rules: ["npm *", "npm install *"] },
          always: ["npm install *"],
          ruleset: [],
        })

        // Deny broad, allow specific — specific should win
        await PermissionNext.saveAlwaysRules({
          requestID: "permission_5",
          approvedAlways: ["npm install *"],
          deniedAlways: ["npm *"],
        })
        await PermissionNext.reply({ requestID: "permission_5", reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // "npm install foo" matches both rules; "npm install *" (allow) comes
        // after "npm *" (deny) in metadata.rules order, so allow wins
        const result = await PermissionNext.ask({
          sessionID: "session_test",
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
        const askPromise = PermissionNext.ask({
          id: "permission_6",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["git log --oneline"],
          metadata: { rules: ["git *", "git log *"] },
          always: ["git log *"],
          ruleset: [],
        })

        await PermissionNext.saveAlwaysRules({
          requestID: "permission_6",
          approvedAlways: ["git log *"],
          deniedAlways: ["git *"],
        })
        await PermissionNext.reply({ requestID: "permission_6", reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // "git log --oneline" should be allowed (specific allow after broad deny)
        const allowed = await PermissionNext.ask({
          sessionID: "session_test",
          permission: "bash",
          patterns: ["git log --oneline"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        expect(allowed).toBeUndefined()

        // "git status" should be denied (only matches broad deny)
        await expect(
          PermissionNext.ask({
            sessionID: "session_test",
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
          }),
        ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
      },
    })
  })

  test("rules not in metadata.rules are silently ignored", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const askPromise = PermissionNext.ask({
          id: "permission_7",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["npm install"],
          metadata: { rules: ["npm *"] },
          always: ["npm *"],
          ruleset: [],
        })

        // "curl" is not in metadata.rules — should be silently ignored
        await PermissionNext.saveAlwaysRules({
          requestID: "permission_7",
          approvedAlways: ["npm *", "curl *"],
        })
        await PermissionNext.reply({ requestID: "permission_7", reply: "once" })
        await expect(askPromise).resolves.toBeUndefined()

        // curl should still require permission (not auto-allowed)
        const curlPromise = PermissionNext.ask({
          id: "permission_curl2",
          sessionID: "session_test",
          permission: "bash",
          patterns: ["curl http://example.com"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        await PermissionNext.reply({ requestID: "permission_curl2", reply: "reject" })
        await expect(curlPromise).rejects.toBeInstanceOf(PermissionNext.RejectedError)
      },
    })
  })
})
