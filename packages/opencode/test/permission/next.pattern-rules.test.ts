import { test, expect } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { NotFoundError } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

test("savePatternRules - approvedPatterns saves allow rules for future requests", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = PermissionNext.ask({
        id: "permission_approved1",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm install"],
        metadata: {},
        always: [],
        ruleset: [],
      })

      // Save pattern rules before replying
      await PermissionNext.savePatternRules({
        requestID: "permission_approved1",
        approvedPatterns: ["npm install"],
      })

      await PermissionNext.reply({
        requestID: "permission_approved1",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // The approved pattern should now auto-allow future requests
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

test("savePatternRules - deniedPatterns saves deny rules for future requests", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = PermissionNext.ask({
        id: "permission_denied1",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {},
        always: [],
        ruleset: [],
      })

      // Save pattern rules before replying
      await PermissionNext.savePatternRules({
        requestID: "permission_denied1",
        deniedPatterns: ["rm -rf /"],
      })

      await PermissionNext.reply({
        requestID: "permission_denied1",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // The denied pattern should now auto-deny future requests
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

test("savePatternRules - multiple bash commands: approve some, deny others", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = PermissionNext.ask({
        id: "permission_multi1",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm install", "npm test", "rm -rf /tmp/cache"],
        metadata: {},
        always: [],
        ruleset: [],
      })

      // Approve npm commands, deny the rm command
      await PermissionNext.savePatternRules({
        requestID: "permission_multi1",
        approvedPatterns: ["npm install", "npm test"],
        deniedPatterns: ["rm -rf /tmp/cache"],
      })

      await PermissionNext.reply({
        requestID: "permission_multi1",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // Approved patterns should auto-allow
      const result1 = await PermissionNext.ask({
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm install"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(result1).toBeUndefined()

      const result2 = await PermissionNext.ask({
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(result2).toBeUndefined()

      // Denied pattern should auto-deny
      await expect(
        PermissionNext.ask({
          sessionID: "session_test",
          permission: "bash",
          patterns: ["rm -rf /tmp/cache"],
          metadata: {},
          always: [],
          ruleset: [],
        }),
      ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
    },
  })
})

test("savePatternRules - multiple bash commands: approve all patterns", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = PermissionNext.ask({
        id: "permission_multi2",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["git status", "git diff", "git log --oneline"],
        metadata: {},
        always: [],
        ruleset: [],
      })

      await PermissionNext.savePatternRules({
        requestID: "permission_multi2",
        approvedPatterns: ["git status", "git diff", "git log --oneline"],
      })

      await PermissionNext.reply({
        requestID: "permission_multi2",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // All three should auto-allow in a single request with multiple patterns
      const result = await PermissionNext.ask({
        sessionID: "session_test",
        permission: "bash",
        patterns: ["git status", "git diff", "git log --oneline"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(result).toBeUndefined()
    },
  })
})

test("savePatternRules - ignores patterns not in the original request", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = PermissionNext.ask({
        id: "permission_multi3",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm install"],
        metadata: {},
        always: [],
        ruleset: [],
      })

      // Try to sneak in an unrelated pattern — should be ignored
      await PermissionNext.savePatternRules({
        requestID: "permission_multi3",
        approvedPatterns: ["npm install", "curl http://evil.com"],
      })

      await PermissionNext.reply({
        requestID: "permission_multi3",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // npm install was in the original request — should be auto-allowed
      const result = await PermissionNext.ask({
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm install"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(result).toBeUndefined()

      // curl was NOT in the original request — should still require permission (ask)
      const curlPromise = PermissionNext.ask({
        id: "permission_curl_check",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["curl http://evil.com"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      // Should be pending (not auto-resolved), meaning it returned a Promise
      expect(curlPromise).toBeInstanceOf(Promise)

      // Clean up the pending request — reject throws RejectedError on the promise
      await PermissionNext.reply({
        requestID: "permission_curl_check",
        reply: "reject",
      })
      await expect(curlPromise).rejects.toBeInstanceOf(PermissionNext.RejectedError)
    },
  })
})

test("savePatternRules - throws error for stale/unknown request ID", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(
        PermissionNext.savePatternRules({
          requestID: "permission_nonexistent",
          approvedPatterns: ["npm install"],
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    },
  })
})

test("savePatternRules - multiple bash commands: deny all patterns", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = PermissionNext.ask({
        id: "permission_multi4",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["rm -rf /", "sudo shutdown", "dd if=/dev/zero of=/dev/sda"],
        metadata: {},
        always: [],
        ruleset: [],
      })

      await PermissionNext.savePatternRules({
        requestID: "permission_multi4",
        deniedPatterns: ["rm -rf /", "sudo shutdown", "dd if=/dev/zero of=/dev/sda"],
      })

      await PermissionNext.reply({
        requestID: "permission_multi4",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // Each denied pattern should auto-deny individually
      for (const pattern of ["rm -rf /", "sudo shutdown", "dd if=/dev/zero of=/dev/sda"]) {
        await expect(
          PermissionNext.ask({
            sessionID: "session_test",
            permission: "bash",
            patterns: [pattern],
            metadata: {},
            always: [],
            ruleset: [],
          }),
        ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
      }
    },
  })
})
