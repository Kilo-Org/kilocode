import { test, expect } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { NotFoundError } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

test("saveAlwaysRules - approvedAlways saves allow rules for future requests", async () => {
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
        always: ["npm *", "npm install"],
        ruleset: [],
      })

      await PermissionNext.saveAlwaysRules({
        requestID: "permission_approved1",
        approvedAlways: ["npm install"],
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

test("saveAlwaysRules - deniedAlways saves deny rules for future requests", async () => {
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
        always: ["rm *", "rm -rf /"],
        ruleset: [],
      })

      await PermissionNext.saveAlwaysRules({
        requestID: "permission_denied1",
        deniedAlways: ["rm -rf /"],
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

test("saveAlwaysRules - multiple bash commands: approve some, deny others", async () => {
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
        always: ["npm *", "npm install", "npm test", "rm *", "rm -rf /tmp/cache"],
        ruleset: [],
      })

      // Approve npm commands, deny the rm command
      await PermissionNext.saveAlwaysRules({
        requestID: "permission_multi1",
        approvedAlways: ["npm install", "npm test"],
        deniedAlways: ["rm -rf /tmp/cache"],
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

test("saveAlwaysRules - multiple bash commands: approve all patterns", async () => {
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
        always: ["git *", "git status", "git diff", "git log *", "git log --oneline"],
        ruleset: [],
      })

      await PermissionNext.saveAlwaysRules({
        requestID: "permission_multi2",
        approvedAlways: ["git status", "git diff", "git log --oneline"],
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

test("saveAlwaysRules - ignores patterns not in always", async () => {
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
        always: ["npm *", "npm install"],
        ruleset: [],
      })

      // Try to sneak in an unrelated pattern — should be ignored
      await PermissionNext.saveAlwaysRules({
        requestID: "permission_multi3",
        approvedAlways: ["npm install", "curl http://evil.com"],
      })

      await PermissionNext.reply({
        requestID: "permission_multi3",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // npm install was in always — should be auto-allowed
      const result = await PermissionNext.ask({
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm install"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(result).toBeUndefined()

      // curl was NOT in always — should still require permission (ask)
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

test("saveAlwaysRules - throws error for stale/unknown request ID", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(
        PermissionNext.saveAlwaysRules({
          requestID: "permission_nonexistent",
          approvedAlways: ["npm install"],
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    },
  })
})

test("saveAlwaysRules - multiple bash commands: deny all patterns", async () => {
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
        always: ["rm *", "rm -rf /", "sudo *", "sudo shutdown", "dd *", "dd if=/dev/zero of=/dev/sda"],
        ruleset: [],
      })

      await PermissionNext.saveAlwaysRules({
        requestID: "permission_multi4",
        deniedAlways: ["rm -rf /", "sudo shutdown", "dd if=/dev/zero of=/dev/sda"],
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

test("saveAlwaysRules - accepts hierarchy patterns from always array", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = PermissionNext.ask({
        id: "permission_hierarchy1",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm install lodash"],
        metadata: {},
        always: ["npm *", "npm install *", "npm install lodash"],
        ruleset: [],
      })

      // Approve a hierarchy pattern that is in always but NOT in patterns
      await PermissionNext.saveAlwaysRules({
        requestID: "permission_hierarchy1",
        approvedAlways: ["npm *"],
      })

      await PermissionNext.reply({
        requestID: "permission_hierarchy1",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // "npm *" should now auto-allow any npm command via wildcard match
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

test("saveAlwaysRules - rejects patterns not in always", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = PermissionNext.ask({
        id: "permission_hierarchy2",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["npm install lodash"],
        metadata: {},
        always: ["npm *", "npm install *", "npm install lodash"],
        ruleset: [],
      })

      // Try to sneak in a pattern not in always — should be ignored
      await PermissionNext.saveAlwaysRules({
        requestID: "permission_hierarchy2",
        approvedAlways: ["rm -rf /"],
      })

      await PermissionNext.reply({
        requestID: "permission_hierarchy2",
        reply: "once",
      })

      await expect(askPromise).resolves.toBeUndefined()

      // "rm -rf /" should NOT be auto-allowed
      const rmPromise = PermissionNext.ask({
        id: "permission_hierarchy2_rm",
        sessionID: "session_test",
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {},
        always: [],
        ruleset: [],
      })

      await PermissionNext.reply({
        requestID: "permission_hierarchy2_rm",
        reply: "once",
      })

      await expect(rmPromise).resolves.toBeUndefined()
    },
  })
})
