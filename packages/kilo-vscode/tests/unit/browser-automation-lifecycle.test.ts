import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../../src/services/cli-backend"
import { BrowserAutomationService } from "../../src/services/browser-automation/browser-automation-service"

describe("Playwright MCP lifecycle", () => {
  const descriptors = Object.getOwnPropertyDescriptors(vscode.workspace)
  const listeners = new Set<() => Promise<void>>()
  const events = new Set<Parameters<KiloConnectionService["onEvent"]>[0]>()
  let service: BrowserAutomationService
  let enabled: boolean
  let connected: boolean
  let failed: boolean
  let pending: Promise<void> | undefined
  let additions: string[]
  let removals: string[]
  let active: Set<string>
  let down: Set<string>
  let started: ReturnType<typeof Promise.withResolvers<void>>

  function folders(dirs: string[]) {
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      value: dirs.map((dir, index) => ({ uri: vscode.Uri.file(dir), name: dir, index })),
    })
  }

  beforeEach(() => {
    enabled = true
    connected = true
    failed = false
    pending = undefined
    additions = []
    removals = []
    active = new Set()
    down = new Set()
    started = Promise.withResolvers<void>()
    folders(["/repo"])
    Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, value: true })
    vscode.workspace.getConfiguration = (() => ({
      get: (key: string, fallback: unknown) => (key === "enabled" ? enabled : fallback),
    })) as typeof vscode.workspace.getConfiguration
    Object.defineProperty(vscode.workspace, "onDidChangeWorkspaceFolders", {
      configurable: true,
      value: (listener: () => Promise<void>) => {
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
      },
    })
    const client = {
      mcp: {
        status: async ({ directory }: { directory: string }) => ({
          data: active.has(directory)
            ? { "kilo-playwright": { status: "connected" } }
            : down.has(directory)
              ? { "kilo-playwright": { status: "failed", error: "MCP startup failed" } }
              : {},
        }),
        add: async ({ name, directory }: { name: string; directory: string }) => {
          additions.push(directory)
          started.resolve()
          await pending
          if (failed) {
            down.add(directory)
            return { data: { [name]: { status: "failed", error: "MCP startup failed" } } }
          }
          down.delete(directory)
          active.add(directory)
          return { data: { [name]: { status: "connected" } } }
        },
        disconnect: async ({ directory }: { directory: string }) => {
          removals.push(directory)
          active.delete(directory)
          down.delete(directory)
        },
      },
    } as unknown as KiloClient
    service = new BrowserAutomationService({
      onEvent: (listener: Parameters<KiloConnectionService["onEvent"]>[0]) => {
        events.add(listener)
        return () => events.delete(listener)
      },
      getClient: () => {
        if (!connected) throw new Error("Disconnected")
        return client
      },
    } as KiloConnectionService)
  })

  afterEach(() => {
    service.dispose()
    listeners.clear()
    events.clear()
    for (const key of Object.getOwnPropertyNames(vscode.workspace)) {
      if (!(key in descriptors)) Reflect.deleteProperty(vscode.workspace, key)
    }
    Object.defineProperties(vscode.workspace, descriptors)
  })

  test("re-registers the same directory after a backend restart", async () => {
    await service.syncWithSettings()
    active.clear()
    await service.reregisterIfEnabled()
    expect(additions).toEqual(["/repo", "/repo"])
    expect([...active]).toEqual(["/repo"])
  })

  test("prompt readiness waits for in-flight MCP startup without restarting it", async () => {
    const gate = Promise.withResolvers<void>()
    pending = gate.promise
    const registration = service.syncWithSettings()
    await started.promise
    let sent = false
    const prompt = service.ready("/repo").then(() => {
      sent = true
    })
    await Promise.resolve()
    expect(sent).toBe(false)
    gate.resolve()
    await Promise.all([registration, prompt])
    expect(sent).toBe(true)
    expect(additions).toEqual(["/repo"])
  })

  test("prompt readiness repairs lost registration before the disposal event arrives", async () => {
    await service.syncWithSettings()
    active.clear()
    await service.ready("/repo")
    expect(additions).toEqual(["/repo", "/repo"])
    expect(active.has("/repo")).toBe(true)
  })

  test("prompt readiness surfaces startup failures rather than submitting without tools", async () => {
    failed = true
    await expect(service.ready("/repo")).rejects.toThrow("Playwright browser automation could not connect")
    expect(active.size).toBe(0)
  })

  test("a failed server is not respawned on every prompt", async () => {
    failed = true
    await expect(service.ready("/repo")).rejects.toThrow("could not connect")
    await expect(service.ready("/repo")).rejects.toThrow("MCP startup failed")
    expect(additions).toEqual(["/repo"])
    failed = false
    await service.syncWithSettings()
    await service.ready("/repo")
    expect(additions).toEqual(["/repo", "/repo"])
    expect(active.has("/repo")).toBe(true)
  })

  test("disabled Playwright and unrelated worktrees do not block prompts", async () => {
    await service.ready("/worktree")
    enabled = false
    await service.ready("/repo")
    expect(additions).toEqual([])
  })

  async function invalidate(directory: string) {
    active.delete(directory)
    await Promise.all(
      [...events].map((listener) =>
        listener(
          {
            type: "server.instance.disposed",
            properties: { directory },
          },
          directory,
        ),
      ),
    )
  }

  test("restores registrations after config disposal without an SSE reconnect", async () => {
    folders(["/repo", "/second"])
    await service.syncWithSettings()
    await invalidate("/repo")
    expect(additions).toEqual(["/repo", "/second", "/repo"])
    expect(active.has("/repo")).toBe(true)
    expect(removals).toEqual([])
    await invalidate("/second")
    expect(active.size).toBe(2)
    expect(additions).toEqual(["/repo", "/second", "/repo", "/second"])
  })

  test("ignores disposal for unrelated Agent Manager directories", async () => {
    await service.syncWithSettings()
    await invalidate("/worktree")
    expect(additions).toEqual(["/repo"])
    expect(removals).toEqual([])
  })

  test("matches canonical disposal paths to workspace aliases", async () => {
    const dir = tmpdir()
    folders([dir])
    await service.syncWithSettings()
    await invalidate(realpathSync(dir))
    expect(additions).toEqual([dir, dir])
  })

  test("does not restore after disposal of the service", async () => {
    await service.syncWithSettings()
    service.dispose()
    await invalidate("/repo")
    expect(events.size).toBe(0)
    expect(additions).toEqual(["/repo"])
  })

  test("does not restore a disposed registration when disabled", async () => {
    await service.syncWithSettings()
    enabled = false
    await invalidate("/repo")
    expect(additions).toEqual(["/repo"])
    expect(removals).toEqual([])
    expect(active.size).toBe(0)
  })

  test("queues disposal behind an in-flight registration", async () => {
    const gate = Promise.withResolvers<void>()
    pending = gate.promise
    const registration = service.syncWithSettings()
    await started.promise
    const reset = invalidate("/repo")
    gate.resolve()
    await Promise.all([registration, reset])
    expect(additions).toEqual(["/repo", "/repo"])
    expect(active.has("/repo")).toBe(true)
  })

  test("a queued disable wins over in-flight registration and reconnect", async () => {
    const gate = Promise.withResolvers<void>()
    pending = gate.promise
    const registration = service.syncWithSettings()
    await started.promise
    const reconnect = service.reregisterIfEnabled()
    enabled = false
    const disable = service.syncWithSettings()
    gate.resolve()
    await Promise.all([registration, reconnect, disable])
    expect(additions).toEqual(["/repo"])
    expect(removals).toEqual(["/repo"])
    expect(active.size).toBe(0)
  })

  test("retries a disable on reconnect without losing its directory", async () => {
    await service.syncWithSettings()
    connected = false
    enabled = false
    await service.syncWithSettings()
    expect([...active]).toEqual(["/repo"])
    connected = true
    await service.reregisterIfEnabled()
    expect(removals).toEqual(["/repo"])
    expect(active.size).toBe(0)
  })

  test("reconciles added and removed folders without restarting retained registrations", async () => {
    folders(["/repo", "/old"])
    await service.syncWithSettings()
    folders(["/repo", "/new"])
    await Promise.all([...listeners].map((listener) => listener()))
    expect(additions).toEqual(["/repo", "/old", "/new"])
    expect(removals).toEqual(["/old"])
    expect([...active]).toEqual(["/repo", "/new"])

    enabled = false
    await service.syncWithSettings()
    folders(["/repo", "/disabled"])
    await Promise.all([...listeners].map((listener) => listener()))
    expect(additions).toEqual(["/repo", "/old", "/new"])
    expect(active.size).toBe(0)
    service.dispose()
    expect(listeners.size).toBe(0)
    expect(events.size).toBe(0)
  })
})
