import { test, expect } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
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
