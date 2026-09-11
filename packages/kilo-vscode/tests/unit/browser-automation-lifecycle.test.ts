import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../../src/services/cli-backend"
import { BrowserAutomationService } from "../../src/services/browser-automation/browser-automation-service"

describe("Playwright MCP lifecycle", () => {
  const descriptors = Object.getOwnPropertyDescriptors(vscode.workspace)
  const listeners = new Set<() => Promise<void>>()
  let service: BrowserAutomationService
  let enabled: boolean
  let connected: boolean
  let pending: Promise<void> | undefined
  let additions: string[]
  let removals: string[]
  let active: Set<string>
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
    pending = undefined
    additions = []
    removals = []
    active = new Set()
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
        add: async ({ name, directory }: { name: string; directory: string }) => {
          additions.push(directory)
          started.resolve()
          await pending
          active.add(directory)
          return { data: { [name]: { status: "connected" } } }
        },
        disconnect: async ({ directory }: { directory: string }) => {
          removals.push(directory)
          active.delete(directory)
        },
      },
    } as unknown as KiloClient
    service = new BrowserAutomationService({
      getClient: () => {
        if (!connected) throw new Error("Disconnected")
        return client
      },
    } as KiloConnectionService)
  })

  afterEach(() => {
    service.dispose()
    listeners.clear()
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
  })
})
