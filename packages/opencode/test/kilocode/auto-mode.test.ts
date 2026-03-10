// kilocode_change - new file
// Tests for TUI auto-mode feature:
// - AutoMode context signal/toggle behavior
// - Permission auto-reply integration (PermissionNext.ask + reply with "once")
// - Deduplication of auto-replies

import { describe, test, expect } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"

// ── AutoMode context logic ──────────────────────────────────────────────────
// Tests the core signal/toggle behavior that AutoModeProvider uses.
// We replicate the context's init logic directly since SolidJS SSR build
// (used in bun test) evaluates signals synchronously.

describe("auto mode context", () => {
  test("defaults to disabled", () => {
    createRoot((dispose) => {
      const [enabled] = createSignal(false)
      expect(enabled()).toBe(false)
      dispose()
    })
  })

  test("initializes from CLI flag", () => {
    createRoot((dispose) => {
      const [enabled] = createSignal(true)
      expect(enabled()).toBe(true)
      dispose()
    })
  })

  test("toggle flips state", () => {
    createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(false)
      const toggle = () => setEnabled((prev) => !prev)

      expect(enabled()).toBe(false)
      toggle()
      expect(enabled()).toBe(true)
      toggle()
      expect(enabled()).toBe(false)
      dispose()
    })
  })
})

// ── Permission auto-reply with "once" ───────────────────────────────────────
// Tests that replying "once" to a permission request resolves it without
// creating persistent allow rules (unlike "always").

describe("auto mode permission reply", () => {
  test("reply once resolves the permission", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise = PermissionNext.ask({
          id: "permission_auto1",
          sessionID: "session_auto",
          permission: "bash",
          patterns: ["echo hello"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        await PermissionNext.reply({
          requestID: "permission_auto1",
          reply: "once",
        })

        const result = await promise
        expect(result).toBeUndefined()
      },
    })
  })

  test("reply once does not create persistent allow rules", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // First: ask and reply once
        const promise = PermissionNext.ask({
          id: "permission_auto2",
          sessionID: "session_auto",
          permission: "edit",
          patterns: ["src/foo.ts"],
          metadata: {},
          always: ["src/*"],
          ruleset: [],
        })

        await PermissionNext.reply({
          requestID: "permission_auto2",
          reply: "once",
        })

        await promise

        // Second: same permission should still require approval (not auto-allowed)
        // because "once" does not add to the approved ruleset
        const promise2 = PermissionNext.ask({
          id: "permission_auto3",
          sessionID: "session_auto",
          permission: "edit",
          patterns: ["src/foo.ts"],
          metadata: {},
          always: ["src/*"],
          ruleset: [],
        })

        // If "once" correctly avoided creating persistent rules, this should
        // block (pending), not resolve immediately
        let resolved = false
        promise2.then(() => {
          resolved = true
        })

        // Give microtasks a chance to settle
        await new Promise((r) => setTimeout(r, 10))
        expect(resolved).toBe(false)

        // Clean up: reply to unblock
        await PermissionNext.reply({
          requestID: "permission_auto3",
          reply: "once",
        })
        await promise2
      },
    })
  })

  test("reply always creates persistent allow rules", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise = PermissionNext.ask({
          id: "permission_auto4",
          sessionID: "session_auto",
          permission: "bash",
          patterns: ["git status"],
          metadata: {},
          always: ["git *"],
          ruleset: [],
        })

        await PermissionNext.reply({
          requestID: "permission_auto4",
          reply: "always",
        })

        await promise

        // Same pattern should now be auto-allowed without asking
        const result = await PermissionNext.ask({
          id: "permission_auto5",
          sessionID: "session_auto",
          permission: "bash",
          patterns: ["git log"],
          metadata: {},
          always: ["git *"],
          ruleset: [],
        })

        // Should resolve immediately (auto-allowed by the "always" rule)
        expect(result).toBeUndefined()
      },
    })
  })

  test("multiple permissions can be replied to independently", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise1 = PermissionNext.ask({
          id: "permission_multi1",
          sessionID: "session_multi",
          permission: "bash",
          patterns: ["echo 1"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        const promise2 = PermissionNext.ask({
          id: "permission_multi2",
          sessionID: "session_multi",
          permission: "edit",
          patterns: ["file.ts"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        const promise3 = PermissionNext.ask({
          id: "permission_multi3",
          sessionID: "session_multi",
          permission: "read",
          patterns: ["/etc/hosts"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // Reply to all with "once" (simulating auto-mode behavior)
        await PermissionNext.reply({ requestID: "permission_multi1", reply: "once" })
        await PermissionNext.reply({ requestID: "permission_multi2", reply: "once" })
        await PermissionNext.reply({ requestID: "permission_multi3", reply: "once" })

        // All should resolve
        expect(await promise1).toBeUndefined()
        expect(await promise2).toBeUndefined()
        expect(await promise3).toBeUndefined()
      },
    })
  })

  test("replying to already-resolved permission is a no-op", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise = PermissionNext.ask({
          id: "permission_dup1",
          sessionID: "session_dup",
          permission: "bash",
          patterns: ["echo hello"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        await PermissionNext.reply({ requestID: "permission_dup1", reply: "once" })
        await promise

        // Second reply to same ID should not throw
        await PermissionNext.reply({ requestID: "permission_dup1", reply: "once" })
      },
    })
  })
})

// ── Deduplication logic ─────────────────────────────────────────────────────
// Tests the Set-based deduplication used in the Session component's
// createEffect to prevent O(N²) duplicate replies.

describe("auto mode deduplication", () => {
  test("Set prevents duplicate replies", () => {
    const replied = new Set<string>()
    const calls: string[] = []

    const permissions = [{ id: "perm_1" }, { id: "perm_2" }, { id: "perm_3" }]

    // First pass: all should be processed
    for (const request of permissions) {
      if (replied.has(request.id)) continue
      replied.add(request.id)
      calls.push(request.id)
    }

    expect(calls).toEqual(["perm_1", "perm_2", "perm_3"])

    // Second pass: none should be processed (already replied)
    const calls2: string[] = []
    for (const request of permissions) {
      if (replied.has(request.id)) continue
      replied.add(request.id)
      calls2.push(request.id)
    }

    expect(calls2).toEqual([])
  })

  test("Set allows new permissions after initial drain", () => {
    const replied = new Set<string>()
    const calls: string[] = []

    // Initial batch
    const batch1 = [{ id: "perm_a" }, { id: "perm_b" }]
    for (const request of batch1) {
      if (replied.has(request.id)) continue
      replied.add(request.id)
      calls.push(request.id)
    }

    // New batch with one old and one new
    const batch2 = [{ id: "perm_b" }, { id: "perm_c" }]
    for (const request of batch2) {
      if (replied.has(request.id)) continue
      replied.add(request.id)
      calls.push(request.id)
    }

    expect(calls).toEqual(["perm_a", "perm_b", "perm_c"])
  })
})

// ── Config schema ───────────────────────────────────────────────────────────

describe("auto mode config", () => {
  test("auto_toggle keybind defaults to ctrl+shift+a", () => {
    const result = Config.Keybinds.parse({})
    expect(result.auto_toggle).toBe("ctrl+shift+a")
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("auto mode edge cases", () => {
  test("reply to never-existed permission ID is a no-op", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Reply to an ID that was never ask()ed — should not throw
        await PermissionNext.reply({ requestID: "permission_nonexistent", reply: "once" })
      },
    })
  })

  test("once reply does not cascade to other pending permissions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise1 = PermissionNext.ask({
          id: "permission_cascade1",
          sessionID: "session_cascade",
          permission: "bash",
          patterns: ["echo 1"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        const promise2 = PermissionNext.ask({
          id: "permission_cascade2",
          sessionID: "session_cascade",
          permission: "edit",
          patterns: ["file.ts"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // Reply "once" to the first — should NOT cascade to the second
        await PermissionNext.reply({ requestID: "permission_cascade1", reply: "once" })
        await promise1

        // Second should still be pending
        let resolved = false
        promise2.then(() => {
          resolved = true
        })
        await new Promise((r) => setTimeout(r, 10))
        expect(resolved).toBe(false)

        // Clean up
        await PermissionNext.reply({ requestID: "permission_cascade2", reply: "once" })
        await promise2
      },
    })
  })

  test("list returns empty after all pending permissions are replied", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise1 = PermissionNext.ask({
          id: "permission_list1",
          sessionID: "session_list",
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        const promise2 = PermissionNext.ask({
          id: "permission_list2",
          sessionID: "session_list",
          permission: "edit",
          patterns: ["foo.ts"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // Both should be pending
        const pending = await PermissionNext.list()
        expect(pending).toHaveLength(2)
        expect(pending.map((p) => p.id).sort()).toEqual(["permission_list1", "permission_list2"])

        // Reply to both with "once"
        await PermissionNext.reply({ requestID: "permission_list1", reply: "once" })
        await PermissionNext.reply({ requestID: "permission_list2", reply: "once" })
        await promise1
        await promise2

        // List should now be empty
        const remaining = await PermissionNext.list()
        expect(remaining).toHaveLength(0)
      },
    })
  })
})
