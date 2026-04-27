/**
 * Unit tests for OnboardingService — runner: `bun test`.
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

const cfgStore: Record<string, unknown> = {}
mock.module("vscode", () => ({
  window: {
    showInformationMessage: mock(async () => undefined),
    showWarningMessage: mock(async () => undefined),
    showQuickPick: mock(async () => undefined),
    showInputBox: mock(async () => undefined),
  },
  workspace: {
    getConfiguration: () => ({ get: <T>(k: string): T | undefined => cfgStore[k] as T | undefined }),
  },
  commands: { registerCommand: () => ({ dispose: () => {} }) },
  env: { openExternal: mock(async () => true) },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
}))

import { OnboardingService } from "../OnboardingService"
import { OnboardingWizard, type OnboardingResult } from "../OnboardingWizard"

function makeContext() {
  return {
    globalState: new FakeMemento(), secrets: new FakeSecretStorage(), subscriptions: [],
  } as unknown as import("vscode").ExtensionContext
}
function makeResult(overrides: Partial<OnboardingResult> = {}): OnboardingResult {
  return {
    mode: "hub", hubBaseUrl: "https://hermes.daveai.tech",
    updateMode: "prompt", updateChannel: "stable",
    minimaxConfigured: true, preferredModel: "claude",
    completedAt: "2026-04-26T12:00:00Z", ...overrides,
  }
}
function stubProbe(svc: OnboardingService, fn: (u: string) => Promise<boolean>) {
  const wiz = (svc as unknown as { wizard: OnboardingWizard }).wizard
  ;(wiz as unknown as { probe: (u: string) => Promise<boolean> }).probe = fn
  ;(wiz as unknown as { resolves: () => Promise<boolean> }).resolves = async () => true
}

describe("OnboardingService.shouldShowWizard", () => {
  it("returns true on a fresh install", () => {
    expect(new OnboardingService(makeContext()).shouldShowWizard()).toBe(true)
  })
  it("toggles false after markComplete and true after resetOnboarding", async () => {
    const svc = new OnboardingService(makeContext())
    await svc.markComplete(makeResult())
    expect(svc.shouldShowWizard()).toBe(false)
    await svc.resetOnboarding()
    expect(svc.shouldShowWizard()).toBe(true)
  })
})

describe("OnboardingService.runDetection", () => {
  let svc: OnboardingService
  beforeEach(() => { svc = new OnboardingService(makeContext()) })

  it("succeeds when remote Hub is reachable", async () => {
    stubProbe(svc, async (u) => u.includes("hermes.daveai.tech"))
    const det = await svc.runDetection()
    expect(det.hubReachable).toBe(true)
    expect(det.hubBaseUrl).toBe("https://hermes.daveai.tech")
  })
  it("falls back to localhost when remote Hub is down", async () => {
    stubProbe(svc, async (u) => u.includes("localhost"))
    const det = await svc.runDetection()
    expect(det.localHubReachable).toBe(true)
    expect(det.hubBaseUrl).toBe("http://localhost:8095")
  })
  it("returns null hubBaseUrl when no Hub is reachable", async () => {
    stubProbe(svc, async () => false)
    expect((await svc.runDetection()).hubBaseUrl).toBeNull()
  })
})

describe("OnboardingService.testConnections", () => {
  it("handles partial failures and reports per-service error", async () => {
    const svc = new OnboardingService(makeContext())
    const wiz = (svc as unknown as { wizard: OnboardingWizard }).wizard
    ;(wiz as unknown as {
      probeWithError: (u: string) => Promise<{ ok: boolean; error?: string }>
    }).probeWithError = async (u) =>
      u.includes("manifest") ? { ok: false, error: "HTTP 503" } : { ok: true }

    const tests = await svc.testConnections(makeResult())
    expect(tests.allOk).toBe(false)
    const failed = tests.services.find((s) => !s.ok)!
    expect(failed.name).toBe("Update manifest")
    expect(failed.error).toBe("HTTP 503")
    expect(tests.services.filter((s) => s.ok).length).toBeGreaterThan(0)
  })
  it("returns empty service list for standalone mode", async () => {
    const svc = new OnboardingService(makeContext())
    const tests = await svc.testConnections(makeResult({ mode: "standalone", hubBaseUrl: null }))
    expect(tests.services.length).toBe(0)
    expect(tests.allOk).toBe(true)
  })
})

describe("OnboardingService.migrateFromLegacy", () => {
  beforeEach(() => { for (const k of Object.keys(cfgStore)) delete cfgStore[k] })

  it("converts old settings keys, is idempotent, and skips invalid values", async () => {
    cfgStore["hub.baseUrl"] = "https://first.example/"
    cfgStore["autoUpdate.mode"] = "silent"
    cfgStore["autoUpdate.channel"] = "garbage"
    const ctx = makeContext()
    const svc = new OnboardingService(ctx)
    await svc.migrateFromLegacy()
    expect(ctx.globalState.get("daveai.hub.baseUrl")).toBe("https://first.example/")
    expect(ctx.globalState.get("daveai.autoUpdate.mode")).toBe("silent")
    expect(ctx.globalState.get("daveai.autoUpdate.channel")).toBeUndefined()
    expect(ctx.globalState.get("daveai.onboarding.migrated")).toBe(true)
    // second call must not overwrite (idempotent)
    cfgStore["hub.baseUrl"] = "https://different.example/"
    await svc.migrateFromLegacy()
    expect(ctx.globalState.get("daveai.hub.baseUrl")).toBe("https://first.example/")
  })
})

describe("OnboardingService.getPersistedResult", () => {
  it("returns the stored result after markComplete", async () => {
    const svc = new OnboardingService(makeContext())
    await svc.markComplete(makeResult({ preferredModel: "minimax" }))
    expect(svc.getPersistedResult()?.preferredModel).toBe("minimax")
  })
})
