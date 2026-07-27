import { describe, it, expect } from "bun:test"
import { ProjectRegistry, type StoredProject } from "../../src/agent-manager/project-registry"

function mem() {
  let value: unknown
  return {
    storage: {
      read: () => value,
      write: (next: unknown) => {
        value = next
      },
    },
    value: () => value,
  }
}

/** Async storage shared by multiple registries: writes are deferred and
 *  serialized through a pending chain so interleaved mutations model real
 *  globalState.update timing. `failNextWrite()` forces the next write to reject. */
function asyncMem() {
  let value: unknown
  let pending: Promise<void> = Promise.resolve()
  let failNext = false
  const storage = {
    read: () => value,
    write: (next: unknown): Promise<void> => {
      const payload = next
      const done = pending.then(() => {
        if (failNext) {
          failNext = false
          throw new Error("write failed")
        }
        value = payload
      })
      pending = done.catch(() => {})
      return done
    },
  }
  return {
    storage,
    value: () => value,
    failNextWrite: () => {
      failNext = true
    },
  }
}

function input(id: string, root = `/repo/${id}`) {
  return { id, root }
}

describe("ProjectRegistry", () => {
  it("starts empty when storage is empty", () => {
    const registry = new ProjectRegistry(mem().storage)
    expect(registry.list()).toEqual([])
  })

  it("adds and lists projects in insertion order", async () => {
    const registry = new ProjectRegistry(mem().storage)
    await registry.add(input("prj-a"))
    await registry.add(input("prj-b"))
    const list = registry.list()
    expect(list.map((p) => p.id)).toEqual(["prj-a", "prj-b"])
    expect(list[0]!.order).toBe(1)
    expect(list[1]!.order).toBe(2)
    expect(list[0]!.trusted).toBe(false)
  })

  it("rejects duplicate ids", async () => {
    const registry = new ProjectRegistry(mem().storage)
    await registry.add(input("prj-a"))
    await expect(registry.add(input("prj-a"))).rejects.toThrow("already registered")
  })

  it("persists across instances sharing storage", async () => {
    const { storage } = mem()
    const first = new ProjectRegistry(storage)
    await first.add(input("prj-a"))
    await first.setTrusted("prj-a", true)
    const second = new ProjectRegistry(storage)
    const project = second.get("prj-a")
    expect(project?.trusted).toBe(true)
    expect(project?.root).toBe("/repo/prj-a")
  })

  it("removes projects and reports unknown ids", async () => {
    const registry = new ProjectRegistry(mem().storage)
    await registry.add(input("prj-a"))
    expect(await registry.remove("prj-a")).toBe(true)
    expect(await registry.remove("prj-a")).toBe(false)
    expect(registry.list()).toEqual([])
  })

  it("updates labels", async () => {
    const registry = new ProjectRegistry(mem().storage)
    await registry.add(input("prj-a"))
    expect(await registry.setLabel("prj-a", "Backend")).toBe(true)
    expect(registry.get("prj-a")?.label).toBe("Backend")
    expect(await registry.setLabel("missing", "x")).toBe(false)
  })

  it("fails closed to an empty catalog for corrupt storage", async () => {
    const { storage } = mem()
    await storage.write({ version: 99, projects: "garbage" })
    const registry = new ProjectRegistry(storage)
    expect(registry.list()).toEqual([])
    await registry.add(input("prj-a"))
    expect(registry.list()).toHaveLength(1)
  })

  it("drops invalid and duplicate entries on load", async () => {
    const { storage } = mem()
    const valid: StoredProject = {
      id: "prj-a",
      root: "/repo/a",
      order: 1,
      trusted: false,
      addedAt: new Date().toISOString(),
    }
    await storage.write({
      version: 1,
      projects: [valid, { id: "broken" }, { ...valid, order: 2 }],
    })
    const registry = new ProjectRegistry(storage)
    expect(registry.list()).toEqual([valid])
  })

  it("merges interleaved writes from two instances sharing async storage", async () => {
    const { storage } = asyncMem()
    const a = new ProjectRegistry(storage)
    const b = new ProjectRegistry(storage)
    // Prime both caches as empty so they go stale once the other instance writes.
    a.list()
    b.list()
    // b writes first; a's cache is now stale but a must re-read and merge.
    await b.add(input("prj-b"))
    await a.add(input("prj-a"))
    // b edits a's project; a's cache is stale but must not overwrite b's trust change.
    await b.setTrusted("prj-a", true)
    // a edits b's project; must merge with b's trust change, not overwrite it.
    await a.setLabel("prj-b", "B")
    // A fresh instance reflects the true persisted catalog: no lost updates.
    const c = new ProjectRegistry(storage)
    expect(
      c
        .list()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["prj-a", "prj-b"])
    expect(c.get("prj-a")?.trusted).toBe(true)
    expect(c.get("prj-b")?.label).toBe("B")
  })

  it("serializes concurrent mutations on one instance so no update is lost", async () => {
    const { storage } = asyncMem()
    const a = new ProjectRegistry(storage)
    await a.add(input("prj-x"))
    // A concurrent add and remove of different ids must both take effect:
    // without the queue the remove reads stale storage and clobbers the add.
    await Promise.all([a.add(input("prj-y")), a.remove("prj-x")])
    expect(
      a
        .list()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["prj-y"])
    expect(
      new ProjectRegistry(storage)
        .list()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["prj-y"])
  })

  it("does not leave memory ahead of storage after a failed write", async () => {
    const { storage, failNextWrite } = asyncMem()
    const a = new ProjectRegistry(storage)
    await a.add(input("prj-a"))
    failNextWrite()
    await expect(a.add(input("prj-b"))).rejects.toThrow("write failed")
    // The failed add must not be visible in memory or in storage.
    expect(a.list().map((p) => p.id)).toEqual(["prj-a"])
    expect(new ProjectRegistry(storage).list().map((p) => p.id)).toEqual(["prj-a"])
    // The queue is not poisoned by the failure: a later mutation still persists.
    await a.add(input("prj-c"))
    expect(
      a
        .list()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["prj-a", "prj-c"])
    expect(
      new ProjectRegistry(storage)
        .list()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["prj-a", "prj-c"])
  })
})
