import { expect, test } from "bun:test"
import { KiloPresenceRpc } from "@opencode-ai/schema/kilocode/presence"
import { createPresenceMethods } from "../src/backend/presence"

test("presence adapter forwards the viewer snapshot over the Kilo-owned RPC envelope", async () => {
  const seen: Array<{
    viewer: { id: string; active: boolean }
    attached: string[]
    visible: string[]
    options?: unknown
  }> = []
  const snapshot = {
    viewer: { id: "0123abcd-0000-4000-8000-000000000001", active: true },
    attached: ["ses_000000000001"],
    visible: ["ses_000000000001", "ses_000000000002"],
  }
  // Minimal rpc transport double: the real-host roundtrip requires the root-owned
  // interactive-server registration of KiloPresenceRpc.
  let failNext = false
  const client = {
    rpc: (definition: unknown) => {
      expect((definition as { id?: string }).id).toBe("kilocode.presence")
      return {
        viewed: async (input: Parameters<ReturnType<typeof createPresenceMethods>["viewed"]>[0], options?: unknown) => {
          seen.push({ ...input, options })
          if (failNext) throw new Error("rpc unavailable")
          return true
        },
      }
    },
  } as never

  const presence = createPresenceMethods(client)
  const accepted = await presence.viewed(snapshot, { throwOnError: true })
  expect(accepted.data).toBe(true)
  expect(seen.length).toBe(1)
  expect(seen[0]?.viewer).toEqual(snapshot.viewer)
  expect(seen[0]?.attached).toEqual(snapshot.attached)
  expect(seen[0]?.visible).toEqual(snapshot.visible)

  failNext = true
  const errored = await presence.viewed(snapshot)
  expect(errored.error).toBeDefined()
  expect(errored.data).toBeUndefined()
})

test("the presence RPC contract mirrors the pinned session.viewed payload", () => {
  const methods = KiloPresenceRpc.Definition.methods
  expect(methods.viewed.output).toBeDefined()
  expect(Object.keys(methods).sort()).toEqual(["viewed"])
})
