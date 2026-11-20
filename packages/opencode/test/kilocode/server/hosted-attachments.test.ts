import * as Attachments from "@/kilocode/server/hosted-attachments"
import { hosted, provider } from "./hosted-fixture"
import { HostedWorkspaceID } from "@/kilocode/session-hosting/types"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

const scope = (providerID: string, workspaceID: string) =>
  Schema.decodeUnknownSync(HostedWorkspaceID)({ providerID, workspaceID })

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

  test("evicts the oldest live attachment when the registry reaches its bound", () => {
    const store = Attachments.create()
    const fake = provider("alpha")
    const first = store.mint({
      provider: fake.value,
      session: hosted("alpha", "ses_00000000000000000000000001"),
      expiresAt: Date.now() + 60_000,
    })
    for (let index = 0; index < 256; index++) {
      store.mint({
        provider: fake.value,
        session: hosted("alpha", `ses_${String(index).padStart(26, "0")}`),
        expiresAt: Date.now() + 60_000,
      })
    }

    expect(store.lookup(first.id).kind).toBe("expired")
  })

  test("recently renewed attachments are not evicted before idle ones", () => {
    const store = Attachments.create()
    const fake = provider("alpha")
    const active = store.mint({
      provider: fake.value,
      session: hosted("alpha", "ses_00000000000000000000000001"),
      expiresAt: Date.now() + 60_000,
    })
    for (let index = 0; index < 255; index++) {
      store.mint({
        provider: fake.value,
        session: hosted("alpha", `ses_${String(index).padStart(26, "0")}`),
        expiresAt: Date.now() + 60_000,
      })
    }
    store.renew(active, { expiresAt: Date.now() + 60_000 })
    store.mint({
      provider: fake.value,
      session: hosted("alpha", "ses_99999999999999999999999999"),
      expiresAt: Date.now() + 60_000,
    })

    expect(store.lookup(active.id).kind).toBe("found")
  })

  test("counts only live attachments for one hosted session", () => {
    const store = Attachments.create()
    const fake = provider("alpha")
    const session = hosted("alpha", "ses_00000000000000000000000001")
    const first = store.mint({ provider: fake.value, session, expiresAt: Date.now() + 60_000 })
    const second = store.mint({ provider: fake.value, session, expiresAt: Date.now() + 60_000 })

    expect(store.count(session)).toBe(2)
    store.dispose(first.id)
    expect(store.count(session)).toBe(1)
    store.dispose(second.id)
    expect(store.count(session)).toBe(0)
  })

  test("disposes every attachment for one composite native session identity", () => {
    const store = Attachments.create()
    const alpha = provider("alpha")
    const beta = provider("beta")
    const session = hosted("alpha", "ses_00000000000000000000000001")
    const first = store.mint({ provider: alpha.value, session, expiresAt: Date.now() + 60_000 })
    const second = store.mint({ provider: alpha.value, session, expiresAt: Date.now() + 60_000 })
    const other = store.mint({
      provider: alpha.value,
      session: hosted("alpha", "ses_00000000000000000000000002"),
      expiresAt: Date.now() + 60_000,
    })
    const foreign = store.mint({
      provider: beta.value,
      session: hosted("beta", "ses_00000000000000000000000001"),
      expiresAt: Date.now() + 60_000,
    })

    store.disposeSession(session)

    expect(store.lookup(first.id).kind).toBe("disposed")
    expect(store.lookup(second.id).kind).toBe("disposed")
    expect(store.lookup(other.id).kind).toBe("found")
    expect(store.lookup(foreign.id).kind).toBe("found")

    store.disposeSession(session)
    expect(store.lookup(first.id).kind).toBe("disposed")
    expect(store.lookup(second.id).kind).toBe("disposed")
    expect(store.lookup(other.id).kind).toBe("found")
    expect(store.lookup(foreign.id).kind).toBe("found")
  })

  test("disposes every attachment in one workspace without touching other workspaces or providers", () => {
    const store = Attachments.create()
    const alpha = provider("alpha")
    const beta = provider("beta")
    const workspace = scope("alpha", "workspace-one")
    const other = scope("alpha", "workspace-two")
    const foreign = scope("beta", "workspace-one")
    const first = store.mint({
      provider: alpha.value,
      session: hosted("alpha", "ses_00000000000000000000000001"),
      workspace,
      expiresAt: Date.now() + 60_000,
    })
    const sibling = store.mint({
      provider: alpha.value,
      session: hosted("alpha", "ses_00000000000000000000000002"),
      workspace,
      expiresAt: Date.now() + 60_000,
    })
    const lonely = store.mint({
      provider: alpha.value,
      session: hosted("alpha", "ses_00000000000000000000000003"),
      expiresAt: Date.now() + 60_000,
    })
    const survivor = store.mint({
      provider: alpha.value,
      session: hosted("alpha", "ses_00000000000000000000000004"),
      workspace: other,
      expiresAt: Date.now() + 60_000,
    })
    const isolated = store.mint({
      provider: beta.value,
      session: hosted("beta", "ses_00000000000000000000000001"),
      workspace: foreign,
      expiresAt: Date.now() + 60_000,
    })

    store.disposeWorkspace(workspace)

    expect(store.lookup(first.id).kind).toBe("disposed")
    expect(store.lookup(sibling.id).kind).toBe("disposed")
    expect(store.lookup(lonely.id).kind).toBe("found")
    expect(store.lookup(survivor.id).kind).toBe("found")
    expect(store.lookup(isolated.id).kind).toBe("found")

    store.disposeWorkspace(workspace)
    expect(store.lookup(first.id).kind).toBe("disposed")
  })

  test("renewal preserves workspace membership", () => {
    let clock = 1_000
    const store = Attachments.create({ now: () => clock })
    const fake = provider("alpha")
    const workspace = scope("alpha", "workspace-one")
    const entry = store.mint({
      provider: fake.value,
      session: hosted("alpha", "ses_00000000000000000000000001"),
      workspace,
      expiresAt: 5_000,
    })

    clock += Attachments.LEASE_MS / 2
    store.renew(entry, { expiresAt: 9_999 })

    expect(store.lookup(entry.id)).toMatchObject({
      kind: "found",
      entry: { workspace, expiresAt: 9_999 },
    })

    store.disposeWorkspace(workspace)
    expect(store.lookup(entry.id).kind).toBe("disposed")
  })
})
