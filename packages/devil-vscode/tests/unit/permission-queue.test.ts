import { describe, it, expect } from "bun:test"
import { upsertPermission, removeSessionPermissions } from "../../webview-ui/src/context/permission-queue"
import type { PermissionRequest } from "../../webview-ui/src/types/messages"

function perm(id: string, sessionID: string): PermissionRequest {
  return { id, sessionID, toolName: "read_file", patterns: [], args: {} }
}

describe("upsertPermission", () => {
  it("appends new permission to empty list", () => {
    const result = upsertPermission([], perm("p1", "s1"))
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("p1")
  })

  it("appends new permission to non-empty list", () => {
    const list = [perm("p1", "s1")]
    const result = upsertPermission(list, perm("p2", "s1"))
    expect(result).toHaveLength(2)
    expect(result[1]!.id).toBe("p2")
  })

  it("replaces existing permission with same id", () => {
    const list = [perm("p1", "s1")]
    const updated = { ...perm("p1", "s1"), toolName: "write_file" }
    const result = upsertPermission(list, updated)
    expect(result).toHaveLength(1)
    expect(result[0]!.toolName).toBe("write_file")
  })

  it("does not mutate the original list on append", () => {
    const list = [perm("p1", "s1")]
    upsertPermission(list, perm("p2", "s1"))
    expect(list).toHaveLength(1)
  })

  it("does not mutate the original list on replace", () => {
    const list = [perm("p1", "s1")]
    upsertPermission(list, { ...perm("p1", "s1"), toolName: "write_file" })
    expect(list[0]!.toolName).toBe("read_file")
  })

  it("replaces by id regardless of position", () => {
    const list = [perm("p1", "s1"), perm("p2", "s1"), perm("p3", "s1")]
    const updated = { ...perm("p2", "s1"), toolName: "write_file" }
    const result = upsertPermission(list, updated)
    expect(result).toHaveLength(3)
    expect(result[1]!.toolName).toBe("write_file")
    expect(result[0]!.toolName).toBe("read_file")
    expect(result[2]!.toolName).toBe("read_file")
  })

  it("handles upsert of same permission idempotently", () => {
    const list: PermissionRequest[] = []
    const r1 = upsertPermission(list, perm("p1", "s1"))
    const r2 = upsertPermission(r1, perm("p1", "s1"))
    expect(r2).toHaveLength(1)
  })
})

describe("removeSessionPermissions", () => {
  it("returns empty list when input is empty", () => {
    expect(removeSessionPermissions([], "s1")).toEqual([])
  })

  it("removes all permissions for given session", () => {
    const list = [perm("p1", "s1"), perm("p2", "s1"), perm("p3", "s2")]
    const result = removeSessionPermissions(list, "s1")
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionID).toBe("s2")
  })

  it("returns all items when session has no permissions", () => {
    const list = [perm("p1", "s1"), perm("p2", "s2")]
    const result = removeSessionPermissions(list, "s3")
    expect(result).toHaveLength(2)
  })

  it("does not mutate the original list", () => {
    const list = [perm("p1", "s1"), perm("p2", "s1")]
    removeSessionPermissions(list, "s1")
    expect(list).toHaveLength(2)
  })

  it("removes all items when all share the session", () => {
    const list = [perm("p1", "s1"), perm("p2", "s1")]
    const result = removeSessionPermissions(list, "s1")
    expect(result).toHaveLength(0)
  })
})
