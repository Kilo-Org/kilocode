import { describe, it, expect } from "bun:test"
import type { KiloConnectionService } from "../../src/services/cli-backend"
import { DiffSourceCatalog } from "../../src/diff/sources/catalog"
import { sessionDescriptor } from "../../src/diff/sources/session"
import { WORKSPACE_DESCRIPTOR } from "../../src/diff/sources/worktree"

// Minimal stand-in for the connection service — the catalog only holds a
// reference and passes it to the source factories, so we never exercise any
// of its methods in these tests.
const connection = {} as unknown as KiloConnectionService

function makeCatalog(): DiffSourceCatalog {
  return new DiffSourceCatalog(connection)
}

describe("DiffSourceCatalog.listAvailable", () => {
  it("returns workspace + session when both are available", () => {
    const out = makeCatalog().listAvailable({ workspaceRoot: "/repo", sessionId: "s1" })
    expect(out.map((d) => d.id)).toEqual(["workspace", "session:s1"])
  })

  it("returns only workspace when sessionId is missing", () => {
    const out = makeCatalog().listAvailable({ workspaceRoot: "/repo" })
    expect(out.map((d) => d.id)).toEqual(["workspace"])
  })

  it("returns only session when workspaceRoot is missing", () => {
    const out = makeCatalog().listAvailable({ workspaceRoot: undefined, sessionId: "s1" })
    expect(out.map((d) => d.id)).toEqual(["session:s1"])
  })

  it("returns [] when the context is empty", () => {
    const out = makeCatalog().listAvailable({ workspaceRoot: undefined })
    expect(out).toEqual([])
  })

  it("returns [] when hidePicker is set, regardless of workspace/session", () => {
    const out = makeCatalog().listAvailable({ workspaceRoot: "/repo", sessionId: "s1", hidePicker: true })
    expect(out).toEqual([])
  })
})

describe("DiffSourceCatalog.defaultSourceId", () => {
  it("prefers explicit initialSourceId", () => {
    const id = makeCatalog().defaultSourceId({
      workspaceRoot: "/repo",
      sessionId: "s1",
      initialSourceId: "workspace",
    })
    expect(id).toBe("workspace")
  })

  it("prefers workspace over session when both are present", () => {
    const id = makeCatalog().defaultSourceId({ workspaceRoot: "/repo", sessionId: "s1" })
    expect(id).toBe("workspace")
  })

  it("falls back to workspace when only workspaceRoot is present", () => {
    const id = makeCatalog().defaultSourceId({ workspaceRoot: "/repo" })
    expect(id).toBe("workspace")
  })

  it("falls back to session when only sessionId is present", () => {
    const id = makeCatalog().defaultSourceId({ workspaceRoot: undefined, sessionId: "s1" })
    expect(id).toBe("session:s1")
  })

  it("returns undefined when nothing can be inferred", () => {
    const id = makeCatalog().defaultSourceId({ workspaceRoot: undefined })
    expect(id).toBeUndefined()
  })
})

describe("DiffSourceCatalog.build", () => {
  it("builds a workspace source for 'workspace'", () => {
    const src = makeCatalog().build("workspace", { workspaceRoot: "/repo" })
    expect(src.descriptor.id).toBe("workspace")
    expect(src.descriptor.type).toBe("workspace")
    expect(src.revert).toBeDefined()
    expect(src.fetchFile).toBeDefined()
    src.dispose?.()
  })

  it("builds a session source for 'session:<id>'", () => {
    const src = makeCatalog().build("session:s1", { workspaceRoot: "/repo", sessionId: "s1" })
    expect(src.descriptor.id).toBe("session:s1")
    expect(src.descriptor.type).toBe("session")
    expect(src.revert).toBeUndefined()
    src.dispose?.()
  })

  it("builds a turn source for 'turn:<sessionId>:<messageId>'", () => {
    const src = makeCatalog().build("turn:sess:msg", { workspaceRoot: "/repo" })
    expect(src.descriptor.id).toBe("turn:sess:msg")
    expect(src.descriptor.type).toBe("turn")
    expect(src.revert).toBeUndefined()
    src.dispose?.()
  })

  it("throws on a malformed turn id", () => {
    expect(() => makeCatalog().build("turn:sess", { workspaceRoot: "/repo" })).toThrow(/malformed turn id/)
    expect(() => makeCatalog().build("turn:", { workspaceRoot: "/repo" })).toThrow(/malformed turn id/)
  })

  it("throws on an empty session id", () => {
    expect(() => makeCatalog().build("session:", { workspaceRoot: "/repo" })).toThrow(/empty session id/)
  })

  it("throws on an unknown source id", () => {
    expect(() => makeCatalog().build("bogus", { workspaceRoot: "/repo" })).toThrow(/unknown source id/)
  })
})

// The webview composes i18n keys from `type`. Keep the type values stable
// so a rename here doesn't silently break existing translation dicts.
describe("descriptor types", () => {
  it("workspace descriptor has type 'workspace'", () => {
    expect(WORKSPACE_DESCRIPTOR.type).toBe("workspace")
  })

  it("session descriptor has type 'session'", () => {
    expect(sessionDescriptor("s1").type).toBe("session")
  })
})
