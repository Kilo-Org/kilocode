import { afterAll, expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { Session } from "@opencode/schema/session"
import * as SandboxActivation from "../../src/sandbox/activation"
import * as SandboxPolicy from "../../src/sandbox/policy"
import { Runtime } from "../../src/sandbox/runtime"
import { SandboxStore } from "../../src/sandbox/store"
import { addSession, cleanup, harness, provide, session, tempdir, type Harness } from "./support"

afterAll(cleanup)

const id = (value: string) => Session.ID.make(value)

function run<A, E>(value: Harness, effect: Effect.Effect<A, E, Runtime>) {
  return Effect.runPromise(provide(value, effect).pipe(Effect.orDie))
}

test("a subagent without its own state inherits the parent snapshot", async () => {
  const directory = await tempdir()
  const value = harness({ directory, config: { sandbox: { enabled: true } } })
  const parent = addSession(value, session("ses_inherit_parent", directory))
  const child = addSession(value, session("ses_inherit_child", directory, { parentID: parent.id }))
  if (!(await run(value, SandboxPolicy.status(parent.id))).available) return

  expect((await run(value, SandboxPolicy.status(child.id))).enabled).toBe(true)
  expect(await SandboxStore.read(directory, child.id)).toEqual({
    enabled: true,
    mode: "deny",
    allowedHosts: [],
    writablePaths: [],
    version: 0,
  })
})

test("a subagent with its own state keeps it", async () => {
  const directory = await tempdir()
  const value = harness({ directory, config: { sandbox: { enabled: true } } })
  const parent = addSession(value, session("ses_own_parent", directory))
  const child = addSession(value, session("ses_own_child", directory, { parentID: parent.id }))
  await SandboxStore.write(directory, child.id, {
    enabled: false,
    mode: "deny",
    allowedHosts: [],
    writablePaths: [],
    version: 3,
  })

  expect((await run(value, SandboxPolicy.status(child.id))).enabled).toBe(false)
  expect(await SandboxStore.read(directory, child.id)).toMatchObject({ enabled: false, version: 3 })
})

test("intersects inherited network and write authority", async () => {
  const directory = await tempdir()
  const value = harness({ directory })
  const parent = id("ses_intersection_parent")
  const child = id("ses_intersection_child")
  await SandboxStore.write(directory, parent, {
    enabled: true,
    mode: "proxy",
    allowedHosts: ["api.github.com:443", "github.com:443"],
    writablePaths: ["/shared", "/parent"],
    version: 0,
  })
  await SandboxStore.write(directory, child, {
    enabled: false,
    mode: "proxy",
    allowedHosts: ["api.github.com:443", "example.com:443"],
    writablePaths: ["/child", "/shared"],
    version: 0,
  })

  await run(value, SandboxPolicy.inherit(parent, child))

  expect(await SandboxStore.read(directory, child)).toEqual({
    enabled: true,
    mode: "proxy",
    allowedHosts: ["api.github.com:443"],
    writablePaths: ["/shared"],
    version: 1,
  })
})

test("carries confinement into another directory without a phantom parent record", async () => {
  const root = await tempdir()
  const worktree = await tempdir()
  const value = harness({ directory: worktree, worktree })
  const parent = id("ses_cross_parent")
  const child = id("ses_cross_child")
  await SandboxStore.write(root, parent, {
    enabled: true,
    mode: "deny",
    allowedHosts: [],
    writablePaths: [],
    version: 0,
  })

  await run(value, SandboxPolicy.inherit(parent, child, undefined, root))

  expect(await SandboxStore.read(worktree, child)).toEqual({
    enabled: true,
    mode: "deny",
    allowedHosts: [],
    writablePaths: [],
    version: 0,
  })
  expect(await SandboxStore.read(worktree, parent)).toBeUndefined()
  expect(await SandboxStore.read(root, child)).toBeUndefined()
})

test("a nested subagent inherits a sandboxed ancestor when its parent has no state yet", async () => {
  const directory = await tempdir()
  // The config default is off: only the root session was sandboxed, by a toggle that left no directory preference.
  const value = harness({ directory })
  const root = addSession(value, session("ses_nested_root", directory))
  const child = addSession(value, session("ses_nested_child", directory, { parentID: root.id }))
  const grandchild = addSession(value, session("ses_nested_grandchild", directory, { parentID: child.id }))
  const confined = { enabled: true, mode: "deny" as const, allowedHosts: [], writablePaths: [], version: 1 }
  await SandboxStore.write(directory, root.id, confined)

  await run(value, SandboxPolicy.status(grandchild.id))

  expect(await SandboxStore.read(directory, grandchild.id)).toEqual({ ...confined, version: 0 })
})

test("inherits a fallback when the parent has no stored snapshot", async () => {
  const directory = await tempdir()
  const value = harness({ directory })
  const parent = id("ses_fallback_parent")
  const child = id("ses_fallback_child")

  await run(
    value,
    SandboxPolicy.inherit(parent, child, { enabled: true, mode: "deny", allowedHosts: [], writablePaths: [] }),
  )

  expect(await SandboxStore.read(directory, child)).toEqual({
    enabled: true,
    mode: "deny",
    allowedHosts: [],
    writablePaths: [],
    version: 0,
  })
  expect(await SandboxStore.read(directory, parent)).toBeUndefined()
})

test("lists the whole session family in nesting order", async () => {
  const directory = await tempdir()
  const childDirectory = path.join(directory, "child")
  const grandchildDirectory = path.join(directory, "grandchild")
  const value = harness({ directory })
  const parent = id("ses_family_parent")
  const child = id("ses_family_child")
  const grandchild = id("ses_family_grandchild")
  value.children.set(parent, [{ id: child, directory: childDirectory }])
  value.children.set(child, [{ id: grandchild, directory: grandchildDirectory }])

  expect(await run(value, SandboxActivation.family(parent))).toEqual([
    { id: parent, directory },
    { id: child, directory: childDirectory },
    { id: grandchild, directory: grandchildDirectory },
  ])
})

test("reports a family idle only when no member runs or owns a background job", async () => {
  const directory = await tempdir()
  const value = harness({ directory })
  const parent = id("ses_idle_parent")
  const child = id("ses_idle_child")
  const family = [
    { id: parent, directory },
    { id: child, directory },
  ]

  expect(await run(value, SandboxActivation.idle(parent, family))).toBe(true)

  value.active.add(child)
  expect(await run(value, SandboxActivation.idle(parent, family))).toBe(false)

  value.active.clear()
  value.background.add(child)
  expect(await run(value, SandboxActivation.idle(parent, family))).toBe(false)
})
