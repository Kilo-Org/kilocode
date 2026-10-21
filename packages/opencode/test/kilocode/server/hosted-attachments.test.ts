import * as Attachments from "@/kilocode/server/hosted-attachments"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { hosted, provider } from "./hosted-fixture"

describe("hosted attachments", () => {
  test("mints an opaque id that stays valid under the workspace selector parser", () => {
    const id = Attachments.createID()

    const raw: string = id
    expect(Attachments.isID(raw)).toBe(true)
    expect(raw.startsWith("wrk_att_")).toBe(true)
    expect(Schema.decodeUnknownOption(WorkspaceV2.ID)(raw)._tag).toBe("Some")
    expect(WorkspaceV2.ID.create()).not.toBe(raw)
  })

  test("never confuses a real workspace id with an attachment id", () => {
    const workspace = WorkspaceV2.ID.create()

    expect(workspace.startsWith("wrk_")).toBe(true)
    expect(Attachments.isID(workspace)).toBe(false)
    expect(Attachments.isID("wrk_att_short")).toBe(false)
    expect(Attachments.isID("wrk_att_0000000000000000000000000!")).toBe(false)
  })

  test("distinguishes unknown, expired, and disposed attachments", () => {
    let clock = 1_000
    const store = Attachments.create({ now: () => clock })
    const fake = provider("alpha")
    const entry = store.mint({
      provider: fake.value,
      session: hosted("alpha", "ses_00000000000000000000000001"),
      expiresAt: 5_000,
    })

    expect(store.lookup(entry.id)).toMatchObject({ kind: "found" })
    expect(store.lookup(Attachments.createID()).kind).toBe("unknown")

    clock += Attachments.LEASE_MS - 1
    expect(store.lookup(entry.id).kind).toBe("found")

    clock += 2
    expect(store.lookup(entry.id).kind).toBe("expired")
    expect(store.lookup(entry.id).kind).toBe("expired")

    store.clear()
    expect(store.lookup(entry.id).kind).toBe("unknown")
  })

  test("renewal refreshes the lease, disposal is terminal, and dispositions are bounded", () => {
    let clock = 1_000
    const store = Attachments.create({ now: () => clock })
    const fake = provider("alpha")
    const entry = store.mint({
      provider: fake.value,
      session: hosted("alpha", "ses_00000000000000000000000002"),
      expiresAt: 5_000,
    })

    clock += Attachments.LEASE_MS - 1
    store.renew(entry, { expiresAt: 9_999 })
    clock += Attachments.LEASE_MS - 1
    expect(store.lookup(entry.id).kind).toBe("found")
    expect(entry.expiresAt).toBe(9_999)

    expect(store.dispose(entry.id)).toBe(true)
    expect(store.lookup(entry.id).kind).toBe("disposed")
    expect(store.dispose(entry.id)).toBe(false)
  })
})
