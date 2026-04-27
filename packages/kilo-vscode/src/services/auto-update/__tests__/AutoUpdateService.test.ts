/**
 * Unit tests for AutoUpdateService — runner: `bun test`.
 * Stubs `vscode` so the service runs outside the extension host.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test"

class FakeMemento {
  private s = new Map<string, unknown>()
  get<T>(k: string, d?: T): T | undefined { return this.s.has(k) ? (this.s.get(k) as T) : d }
  async update(k: string, v: unknown) { v === undefined ? this.s.delete(k) : this.s.set(k, v) }
}
class FakeSecretStorage {
  private s = new Map<string, string>()
  async get(k: string) { return this.s.get(k) }
  async store(k: string, v: string) { this.s.set(k, v) }
  async delete(k: string) { this.s.delete(k) }
}
class FakeEventEmitter<T> {
  private ls: Array<(a: T) => void> = []
  event = (cb: (a: T) => void) => { this.ls.push(cb); return { dispose: () => {} } }
  fire(a: T) { this.ls.forEach((l) => l(a)) }
  dispose() { this.ls = [] }
}

mock.module("vscode", () => ({
  EventEmitter: FakeEventEmitter,
  Uri: { file: (p: string) => ({ fsPath: p }), parse: (s: string) => ({ toString: () => s }) },
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
    showInformationMessage: mock(async () => undefined),
    showWarningMessage: mock(async () => undefined),
  },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
  commands: { executeCommand: mock(async () => undefined) },
  env: { openExternal: mock(async () => true) },
}))

import { AutoUpdateService, compareSemver, type Manifest, type UpdateInfo } from "../AutoUpdateService"

function makeContext(currentVersion = "2.1.3") {
  return {
    extension: { packageJSON: { version: currentVersion } },
    globalState: new FakeMemento(), secrets: new FakeSecretStorage(), subscriptions: [],
  } as unknown as import("vscode").ExtensionContext
}
function makeManifest(version: string, overrides: Partial<Manifest> = {}): Manifest {
  const f = { version, sha256: "a".repeat(64), size: 1000 }
  return {
    channel: "stable", version, publishedAt: "2026-04-26T17:55:00Z",
    components: { "kilocode-vsix": f, "webui-bundle": f, pipelines: f,
      "hub-image": { version, imageRef: "ghcr.io/x:1", digest: "sha256:" + "c".repeat(64) } },
    signature: "ed25519:fake", ...overrides,
  }
}
function stub(svc: AutoUpdateService, m: Manifest | null | Error): void {
  ;(svc as unknown as { fetchManifest: (c: string) => Promise<Manifest | null> }).fetchManifest =
    async () => { if (m instanceof Error) throw m; return m }
}

describe("compareSemver", () => {
  it("orders versions correctly", () => {
    expect(compareSemver("2.2.0", "2.1.3")).toBe(1)
    expect(compareSemver("2.1.3", "2.2.0")).toBe(-1)
    expect(compareSemver("2.2.0", "2.2.0")).toBe(0)
    expect(compareSemver("10.0.0", "9.99.99")).toBe(1)
  })
})

describe("AutoUpdateService.checkNow", () => {
  let svc: AutoUpdateService
  beforeEach(() => { svc = new AutoUpdateService(makeContext("2.1.3"), "http://localhost:8082") })

  it("fires onUpdateAvailable when version > current", async () => {
    stub(svc, makeManifest("2.2.0"))
    let fired: UpdateInfo | null = null
    svc.onUpdateAvailable((i) => { fired = i })
    expect(await svc.checkNow()).not.toBeNull()
    expect(fired!.newVersion).toBe("2.2.0")
    expect(fired!.isForced).toBe(false)
  })

  it("does not fire when version <= current", async () => {
    let fired = false
    svc.onUpdateAvailable(() => { fired = true })
    stub(svc, makeManifest("2.1.3"))
    expect(await svc.checkNow()).toBeNull()
    stub(svc, makeManifest("2.0.0"))
    expect(await svc.checkNow()).toBeNull()
    expect(fired).toBe(false)
  })

  it("marks forced when current < minimumVersion", async () => {
    stub(svc, makeManifest("2.2.0", { minimumVersion: "2.2.0" }))
    let fired: UpdateInfo | null = null
    svc.onUpdateAvailable((i) => { fired = i })
    await svc.checkNow()
    expect(fired!.isForced).toBe(true)
  })

  it("network errors don't crash; lastCheckedAt updates", async () => {
    stub(svc, new Error("ECONNREFUSED"))
    let fired = false
    svc.onUpdateAvailable(() => { fired = true })
    expect(await svc.checkNow()).toBeNull()
    expect(fired).toBe(false)
    stub(svc, null)
    await svc.checkNow()
    expect(new Date(svc.getLastCheckedAt()!).getTime()).toBeGreaterThan(0)
  })
})

describe("AutoUpdateService — settings persistence", () => {
  it("Skip silences future prompts (but not when forced)", async () => {
    const svc = new AutoUpdateService(makeContext("2.1.3"), "http://localhost:8082")
    await svc.addSkippedVersion("2.2.0")
    let fired = false
    svc.onUpdateAvailable(() => { fired = true })
    stub(svc, makeManifest("2.2.0"))
    expect(await svc.checkNow()).toBeNull()
    expect(fired).toBe(false)
    stub(svc, makeManifest("2.2.0", { minimumVersion: "2.2.0" }))
    await svc.checkNow()
    expect(fired).toBe(true)
  })

  it("Always Auto-Update toggle persists across instances", async () => {
    const ctx = makeContext()
    const a = new AutoUpdateService(ctx, "http://localhost:8082")
    expect(a.getMode()).toBe("prompt")
    await a.setMode("silent")
    expect(new AutoUpdateService(ctx, "http://localhost:8082").getMode()).toBe("silent")
  })

  it("channel + skipped versions persist across instances", async () => {
    const ctx = makeContext()
    const a = new AutoUpdateService(ctx, "http://localhost:8082")
    await a.setChannel("canary")
    await a.addSkippedVersion("2.2.0")
    const b = new AutoUpdateService(ctx, "http://localhost:8082")
    expect(b.getChannel()).toBe("canary")
    expect(b.getSkippedVersions()).toEqual(["2.2.0"])
  })

  it("generates and persists clientId UUID v4", async () => {
    const svc = new AutoUpdateService(makeContext(), "http://localhost:8082")
    const id = await svc.getClientId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(await svc.getClientId()).toBe(id)
  })
})
