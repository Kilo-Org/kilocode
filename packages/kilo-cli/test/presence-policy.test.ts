import { afterEach, describe, expect, test } from "bun:test"
import {
  attachedUnion,
  dedupe,
  desiredContexts,
  expiredViewerIds,
  nextExpiryDeadline,
  reconcileContexts,
  validateSnapshot,
  visibleUnion,
} from "../src/presence-policy"
import {
  MAX_ATTACHED_PER_VIEWER,
  MAX_VISIBLE_PER_VIEWER,
  MAX_VISIBLE_SESSIONS,
  VIEWER_TTL_MS,
} from "../src/presence-context"

const VIEWER = { id: "0123abcd-0000-4000-8000-000000000001", active: true }
const ses = (n: number) => `ses_${String(n).padStart(12, "0")}`

function viewerState(id: string, active: boolean, attached: string[], visible: string[], lastSeen: number) {
  return { id, active, attached, visible, lastSeen }
}

describe("presence policy", () => {
  test("validateSnapshot rejects missing and malformed viewer ids", () => {
    expect(validateSnapshot({})).toMatchObject({ ok: false, error: { kind: "missing_viewer" } })
    expect(validateSnapshot({ viewer: { id: "not-a-uuid", active: true } })).toMatchObject({
      ok: false,
      error: { kind: "bad_viewer_id" },
    })
  })

  test("validateSnapshot rejects oversized snapshots before dedupe work", () => {
    const tooManyAttached = Array.from({ length: MAX_ATTACHED_PER_VIEWER + 1 }, () => ses(1))
    expect(validateSnapshot({ viewer: VIEWER, attached: tooManyAttached, visible: [] })).toMatchObject({
      ok: false,
      error: { kind: "attached_too_many" },
    })
    const oversizedVisible = Array.from({ length: MAX_VISIBLE_PER_VIEWER + 1 }, (_, index) => ses(index))
    expect(validateSnapshot({ viewer: VIEWER, attached: [], visible: oversizedVisible })).toMatchObject({
      ok: false,
      error: { kind: "visible_too_many" },
    })
  })

  test("validateSnapshot rejects non-session ids and coerces active to boolean", () => {
    const bad = validateSnapshot({ viewer: VIEWER, attached: ["evil"], visible: [] })
    expect(bad).toMatchObject({ ok: false, error: { kind: "bad_session_id", id: "evil" } })
    const ok = validateSnapshot({ viewer: { id: VIEWER.id, active: "truthy" }, attached: [ses(1)], visible: [] })
    expect(ok.ok && ok.viewer.active).toBe(false)
  })

  test("validateSnapshot dedupes while preserving first-seen order", () => {
    const result = validateSnapshot({ viewer: VIEWER, attached: [ses(2), ses(1), ses(2)], visible: [] })
    expect(result.ok && result.attached).toEqual([ses(2), ses(1)])
    expect(dedupe(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"])
  })

  test("attachedUnion keeps inactive viewers' ids; visibleUnion is active-only and capped", () => {
    const viewers = [
      viewerState("v1", true, [ses(1)], [ses(1), ses(2)], 0),
      viewerState("v2", false, [ses(3)], [ses(3)], 0),
    ]
    expect(attachedUnion(viewers)).toEqual([ses(1), ses(3)])
    const { ids, omitted } = visibleUnion(viewers)
    expect(ids).toEqual([ses(1), ses(2)])
    expect(omitted).toBe(0)

    const many = Array.from({ length: MAX_VISIBLE_SESSIONS + 5 }, (_, index) => ses(index))
    const capped = visibleUnion([viewerState("v1", true, many, many, 0)])
    expect(capped.ids.length).toBe(MAX_VISIBLE_SESSIONS)
    expect(capped.omitted).toBe(5)
  })

  test("expiry helpers honor the 120s lease", () => {
    const now = 1_000_000
    const viewers = [
      viewerState("v1", true, [], [], now - VIEWER_TTL_MS),
      viewerState("v2", true, [], [], now - 1),
    ]
    expect(expiredViewerIds(viewers, now)).toEqual(["v1"])
    expect(nextExpiryDeadline(viewers, now)).toBe(now - 1 + VIEWER_TTL_MS)
    expect(expiredViewerIds(viewers, now - 1)).toEqual([])
  })

  test("reconcileContexts computes removals then additions", () => {
    const { remove, add } = reconcileContexts(new Set(["a", "b"]), new Set(["b", "c"]))
    expect(remove).toEqual(["a"])
    expect(add).toEqual(["c"])
  })

  test("desiredContexts publishes the platform context only while a viewer is active", () => {
    expect(desiredContexts("vscode", true, [ses(1)])).toEqual(
      new Set(["/presence/vscode", `/presence/cli-session/${ses(1)}`]),
    )
    expect(desiredContexts("vscode", false, [ses(1)])).toEqual(new Set([`/presence/cli-session/${ses(1)}`]))
  })
})

afterEach(() => {
  for (const key of ["KILO_API_KEY"]) delete process.env[key]
})
