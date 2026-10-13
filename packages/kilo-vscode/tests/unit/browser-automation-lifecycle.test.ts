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
  let connection: KiloConnectionService
  let enabled: boolean
  let connected: boolean
  let failed: boolean
  let pending: Promise<void> | undefined
  let additions: string[]
  let commands: string[][]
  let allowed: string[] | undefined
  let installed: boolean

  // Start a browser the way an agent does. No server runs before that.
  async function start(...dirs: string[]) {
    for (const directory of dirs.length ? dirs : ["/repo"]) {
      await service.handle("/playwright/profile", { sessionID: "starter", directory, browser: "chrome" })
    }
  }
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
    commands = []
    allowed = undefined
    installed = true
    removals = []
    active = new Set()
    down = new Set()
    started = Promise.withResolvers<void>()
    folders(["/repo"])
    Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, value: true })
    vscode.workspace.getConfiguration = (() => ({
      get: (key: string, fallback: unknown) => (key === "enabled" ? enabled : fallback),
      inspect: (key: string) => (key === "browsers" ? { globalValue: allowed } : undefined),
    })) as unknown as typeof vscode.workspace.getConfiguration
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
        add: async (input: { name: string; directory: string; config: { command: string[] } }) => {
          const name = input.name
          const directory = input.directory
          additions.push(directory)
          commands.push(input.config.command)
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
    connection = {
      onEvent: (listener: Parameters<KiloConnectionService["onEvent"]>[0]) => {
        events.add(listener)
        return () => events.delete(listener)
      },
      getClient: () => {
        if (!connected) throw new Error("Disconnected")
        return client
      },
    } as KiloConnectionService
    service = new BrowserAutomationService(connection, undefined, async () => (installed ? "installed" : "missing"))
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
    await start()
    active.clear()
    await service.reregisterIfEnabled()
    expect(additions).toEqual(["/repo", "/repo"])
    expect([...active]).toEqual(["/repo"])
  })

  test("prompt readiness waits for in-flight MCP startup without restarting it", async () => {
    const gate = Promise.withResolvers<void>()
    pending = gate.promise
    const registration = start()
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

  test("prompt readiness gives up after the wait instead of stalling on startup", async () => {
    const gate = Promise.withResolvers<void>()
    pending = gate.promise
    service.dispose()
    service = new BrowserAutomationService(connection, 5, async () => "installed")
    const registration = start()
    await started.promise
    await service.ready("/repo")
    expect(active.size).toBe(0)
    gate.resolve()
    await registration
    expect(active.has("/repo")).toBe(true)
  })

  test("prompt readiness repairs lost registration before the disposal event arrives", async () => {
    await start()
    active.clear()
    await service.ready("/repo")
    expect(additions).toEqual(["/repo", "/repo"])
    expect(active.has("/repo")).toBe(true)
  })

  test("prompt readiness surfaces startup failures rather than submitting without tools", async () => {
    await start()
    active.clear()
    failed = true
    await expect(service.ready("/repo")).rejects.toThrow("Playwright browser automation could not connect")
    expect(active.size).toBe(0)
  })

  test("a failed server is not respawned on every prompt", async () => {
    await start()
    active.clear()
    failed = true
    await expect(service.ready("/repo")).rejects.toThrow("could not connect")
    await expect(service.ready("/repo")).rejects.toThrow("MCP startup failed")
    expect(additions).toEqual(["/repo", "/repo"])
    failed = false
    await service.reregisterIfEnabled()
    await service.ready("/repo")
    expect(additions).toEqual(["/repo", "/repo", "/repo"])
    expect(active.has("/repo")).toBe(true)
  })

  test("folders without a browser, disabled Playwright, and unrelated worktrees do not block prompts", async () => {
    await service.syncWithSettings()
    await service.ready("/repo")
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
    await start("/repo", "/second")
    await invalidate("/repo")
    expect(additions).toEqual(["/repo", "/second", "/repo"])
    expect(active.has("/repo")).toBe(true)
    expect(removals).toEqual([])
    await invalidate("/second")
    expect(active.size).toBe(2)
    expect(additions).toEqual(["/repo", "/second", "/repo", "/second"])
  })

  test("ignores disposal for unrelated Agent Manager directories", async () => {
    await start()
    expect(events.size).toBe(1)
    await invalidate("/worktree")
    expect(additions).toEqual(["/repo"])
    expect(removals).toEqual([])
  })

  test("matches canonical disposal paths to workspace aliases", async () => {
    const dir = tmpdir()
    folders([dir])
    await start(dir)
    await invalidate(realpathSync(dir))
    expect(additions).toEqual([dir, dir])
  })

  test("does not restore after disposal of the service", async () => {
    await start()
    service.dispose()
    await invalidate("/repo")
    expect(events.size).toBe(0)
    expect(additions).toEqual(["/repo"])
  })

  test("does not restore a disposed registration when disabled", async () => {
    await start()
    enabled = false
    expect(events.size).toBe(1)
    await invalidate("/repo")
    expect(additions).toEqual(["/repo"])
    expect(removals).toEqual([])
    expect(active.size).toBe(0)
    // The handler ran: it dropped the directory, so a reconcile registers it again.
    enabled = true
    await Promise.all([...listeners].map((listener) => listener()))
    expect(additions).toEqual(["/repo", "/repo"])
  })

  test("queues disposal behind an in-flight registration", async () => {
    const gate = Promise.withResolvers<void>()
    pending = gate.promise
    const registration = start()
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
    const registration = start()
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
    await start()
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
    await start("/repo", "/old")
    folders(["/repo", "/new"])
    await Promise.all([...listeners].map((listener) => listener()))
    // The new folder gets a server only when an agent picks a browser there.
    expect(additions).toEqual(["/repo", "/old"])
    expect(removals).toEqual(["/old"])
    expect([...active]).toEqual(["/repo"])

    enabled = false
    await service.syncWithSettings()
    folders(["/repo", "/disabled"])
    await Promise.all([...listeners].map((listener) => listener()))
    expect(additions).toEqual(["/repo", "/old"])
    expect(active.size).toBe(0)
    service.dispose()
    expect(listeners.size).toBe(0)
    expect(events.size).toBe(0)
  })

  describe("agent-selected browser profile", () => {
    type Event = Parameters<Parameters<KiloConnectionService["onEvent"]>[0]>[0]
    const emit = (event: unknown, directory?: string) => {
      for (const listener of events) listener(event as Event, directory)
    }
    const select = (sessionID: string, body: Record<string, unknown> = {}, directory = "/repo") =>
      service.handle("/playwright/profile", { sessionID, directory, ...body }) as Promise<{
        browser: string
        device?: string
        viewport?: string
        headless?: boolean
        allowed: string[]
        changed: boolean
      }>
    const flags = () => commands.at(-1)?.slice(2, -2)

    test("runs no browser until an agent picks one", async () => {
      allowed = ["webkit", "chromium"]
      await service.syncWithSettings()
      await service.reregisterIfEnabled()
      expect(await select("a")).toEqual({ allowed: ["chromium", "webkit"], changed: false })
      await expect(select("a", { device: "iPhone 15" })).rejects.toThrow("No browser is running yet")
      expect(additions).toEqual([])

      expect(await select("a", { browser: "chromium" })).toEqual({
        browser: "chromium",
        device: undefined,
        viewport: undefined,
        headless: false,
        allowed: ["chromium", "webkit"],
        changed: true,
      })
      expect(flags()).toEqual(["--browser", "chromium"])
      expect(await select("a")).toMatchObject({ browser: "chromium", changed: false })
      expect(additions).toEqual(["/repo"])
    })

    test("shows the window unless headless is requested", async () => {
      allowed = ["chrome"]
      expect(await select("a", { browser: "chrome", headless: true })).toMatchObject({ headless: true, changed: true })
      expect(flags()).toEqual(["--headless", "--browser", "chrome"])
      // Headless is not kept when it is not passed again.
      expect(await select("a", { browser: "chrome" })).toMatchObject({ headless: false, changed: true })
      expect(flags()).toEqual(["--browser", "chrome"])
      expect(await select("a", { browser: "chrome", headless: false })).toMatchObject({ changed: false })
    })

    test("refuses a browser that is not installed", async () => {
      allowed = ["chrome", "firefox"]
      installed = false
      await expect(select("a", { browser: "firefox" })).rejects.toThrow("firefox is not installed")
      expect(additions).toEqual([])
      installed = true
      expect(await select("b", { browser: "firefox" })).toMatchObject({ changed: true })
    })

    test("restarts the server with the requested browser, device, and viewport", async () => {
      allowed = ["chrome", "webkit"]
      await service.syncWithSettings()
      expect(await select("a", { browser: "webkit", device: "iPhone 15", viewport: "390x844" })).toMatchObject({
        browser: "webkit",
        device: "iPhone 15",
        viewport: "390x844",
        changed: true,
      })
      expect(flags()).toEqual(["--browser", "webkit", "--device", "iPhone 15", "--viewport-size", "390x844"])

      // A repeated request keeps the running browser.
      expect(await select("a", { browser: "webkit", device: "iPhone 15", viewport: "390x844" })).toMatchObject({
        changed: false,
      })
      // Options that are not passed again reset, and the browser stays the same.
      expect(await select("a", { viewport: "1280x720" })).toMatchObject({ browser: "webkit", changed: true })
      expect(flags()).toEqual(["--browser", "webkit", "--viewport-size", "1280x720"])
      expect(additions).toHaveLength(2)

      // Later registrations keep the selected profile.
      active.clear()
      await service.reregisterIfEnabled()
      expect(flags()).toEqual(["--browser", "webkit", "--viewport-size", "1280x720"])
    })

    test("rejects browsers the user did not allow and invalid profiles", async () => {
      allowed = ["chrome", "firefox"]
      await service.syncWithSettings()
      await expect(select("a", { browser: "webkit" })).rejects.toThrow("not allowed")
      await expect(select("a", { browser: "netscape" })).rejects.toThrow("not allowed")
      await expect(select("a", { browser: "firefox", device: "Pixel 7" })).rejects.toThrow("mobile device")
      await expect(select("a", { browser: "chrome", viewport: "wide" })).rejects.toThrow("WIDTHxHEIGHT")
      await expect(select("a", { browser: "firefox" }, "/repo/.kilo/worktrees/one")).rejects.toThrow("not available")
      expect(additions).toEqual([])
    })

    test("refuses another session until the turn of the owner ends", async () => {
      allowed = ["chrome", "firefox", "webkit"]
      await service.syncWithSettings()
      await select("a", { browser: "firefox" })
      await expect(select("b", { browser: "webkit" })).rejects.toThrow("Another chat session")
      expect(await select("b")).toMatchObject({ browser: "firefox" })
      emit({ type: "session.status", properties: { sessionID: "a", status: { type: "busy" } } })
      await expect(select("b", { browser: "webkit" })).rejects.toThrow("Another chat session")
      emit({ type: "session.status", properties: { sessionID: "a", status: { type: "idle" } } })
      expect(await select("b", { browser: "webkit" })).toMatchObject({ browser: "webkit", changed: true })
    })

    test("a session that uses the browser tools owns the browser", async () => {
      allowed = ["chrome", "webkit"]
      await service.syncWithSettings()
      const part = (sessionID: string, tool: string) => ({
        type: "message.part.updated",
        properties: { part: { type: "tool", tool, sessionID } },
      })
      emit(part("a", "read"), "/repo")
      emit(part("a", "kilo-playwright_browser_navigate"), "/elsewhere")
      expect(await select("b", { browser: "webkit" })).toMatchObject({ changed: true })
      emit({ type: "session.status", properties: { sessionID: "b", status: { type: "idle" } } })

      emit(part("a", "kilo-playwright_browser_navigate"), "/repo")
      await expect(select("b", { browser: "chrome" })).rejects.toThrow("Another chat session")
      expect(await select("a", { browser: "chrome" })).toMatchObject({ changed: true })
    })

    test("restores the previous profile when the new one cannot start", async () => {
      allowed = ["chrome", "webkit"]
      await select("a", { browser: "chrome" })
      failed = true
      await expect(select("a", { browser: "webkit" })).rejects.toThrow("previous profile was restored")
      expect(commands.map((command) => command.at(3))).toEqual(["chrome", "webkit", "chrome"])
      failed = false
      expect(await select("a")).toMatchObject({ browser: "chrome" })
    })

    test("stays without a browser when the first one cannot start", async () => {
      allowed = ["chrome", "webkit"]
      failed = true
      await expect(select("a", { browser: "webkit" })).rejects.toThrow("could not start")
      expect(additions).toEqual(["/repo"])
      failed = false
      expect(await select("a")).toEqual({ allowed: ["chrome", "webkit"], changed: false })
    })

    test("a settings change stops the browser and frees it", async () => {
      allowed = ["chrome", "webkit"]
      await select("a", { browser: "webkit" })
      allowed = ["chrome"]
      await service.syncWithSettings()
      expect(removals).toEqual(["/repo"])
      expect(active.size).toBe(0)
      expect(await select("b")).toEqual({ allowed: ["chrome"], changed: false })
      expect(await select("b", { browser: "chrome" })).toMatchObject({ changed: true })
    })

    test("reports availability only for enabled workspace folders", async () => {
      const status = (directory: string) => service.handle("/playwright/status", { sessionID: "", directory })
      expect(await status("/repo")).toEqual({ enabled: true })
      expect(await status("/repo/.kilo/worktrees/one")).toEqual({ enabled: false })
      enabled = false
      expect(await status("/repo")).toEqual({ enabled: false })
      await expect(select("a", { browser: "chrome" })).rejects.toThrow("disabled")
      expect(service.handle("/browser/unknown", {})).toBeUndefined()
    })
  })
})
