// packages/opencode/test/devilcode/workflow-tui/team-registry.commands.test.ts
// Phase 8 — unit tests for team-registry command handlers
import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import {
  publishCommand,
  installCommand,
  trustCommand,
  untrustCommand,
  registerTeamRegistryCommands,
  type TeamRegistryCommandHandlers,
} from "@/devilcode/workflow-tui/commands/team-registry"
import { generateKeyPair } from "@/devilcode/team/registry/signing"
import { publishManifest } from "@/devilcode/team/registry/io"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"
import type { Command } from "@devilcode/keybind"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-registry-cmd-test-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function fixtureTeam(): CanonicalTeamConfig {
  return loadQuickstartTemplates()["solo-enhanced"].team as CanonicalTeamConfig
}

function makeHandlers(team?: CanonicalTeamConfig): TeamRegistryCommandHandlers {
  return {
    getActiveTeam: mock(() => team),
    onInstalled: mock(async () => {}),
    toast: {
      success: mock(() => {}),
      error: mock(() => {}),
      warning: mock(() => {}),
    },
  }
}

// ─── publishCommand ──────────────────────────────────────────────────────────

describe("publishCommand", () => {
  test("calls toast.success on successful publish", async () => {
    const handlers = makeHandlers(fixtureTeam())
    const outputPath = path.join(tmpDir, "out.manifest.json")
    await publishCommand({ path: outputPath, name: "My Team", author: "Author", version: "1.0.0" }, handlers)
    const successCalls = (handlers.toast.success as ReturnType<typeof mock>).mock.calls
    expect(successCalls.length).toBe(1)
    expect(successCalls[0][0]).toContain(path.resolve(outputPath))
    // File should exist
    const stat = await fs.stat(outputPath)
    expect(stat.isFile()).toBe(true)
  })

  test("calls toast.error when no active team", async () => {
    const handlers = makeHandlers(undefined)
    const outputPath = path.join(tmpDir, "no-team.json")
    await publishCommand({ path: outputPath, name: "N", author: "A", version: "1.0.0" }, handlers)
    const errorCalls = (handlers.toast.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.length).toBe(1)
    expect(errorCalls[0][0]).toContain("No active team")
    const successCalls = (handlers.toast.success as ReturnType<typeof mock>).mock.calls
    expect(successCalls.length).toBe(0)
  })

  test("includes (signed) note when sign key provided", async () => {
    const { privateKey } = generateKeyPair()
    const keyFile = path.join(tmpDir, "key.pem")
    await fs.writeFile(keyFile, privateKey, "utf-8")

    const handlers = makeHandlers(fixtureTeam())
    const outputPath = path.join(tmpDir, "signed.manifest.json")
    await publishCommand({ path: outputPath, name: "T", author: "A", version: "1.0.0", sign: keyFile }, handlers)

    const successCalls = (handlers.toast.success as ReturnType<typeof mock>).mock.calls
    expect(successCalls.length).toBe(1)
    expect(successCalls[0][0]).toContain("(signed)")
  })

  test("includes (unsigned) note when no sign key", async () => {
    const handlers = makeHandlers(fixtureTeam())
    const outputPath = path.join(tmpDir, "unsigned.manifest.json")
    await publishCommand({ path: outputPath, name: "T", author: "A", version: "1.0.0" }, handlers)

    const successCalls = (handlers.toast.success as ReturnType<typeof mock>).mock.calls
    expect(successCalls[0][0]).toContain("(unsigned)")
  })

  test("calls toast.error if sign key file does not exist", async () => {
    const handlers = makeHandlers(fixtureTeam())
    const outputPath = path.join(tmpDir, "fail.json")
    await publishCommand({
      path: outputPath,
      name: "T",
      author: "A",
      version: "1.0.0",
      sign: path.join(tmpDir, "nonexistent.pem"),
    }, handlers)
    const errorCalls = (handlers.toast.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.length).toBe(1)
    expect(errorCalls[0][0]).toContain("Publish failed:")
  })
})

// ─── installCommand ──────────────────────────────────────────────────────────

describe("installCommand", () => {
  test("calls toast.warning for unsigned manifest warnings and toast.success on completion", async () => {
    const outputPath = path.join(tmpDir, "install.manifest.json")
    await publishManifest(fixtureTeam(), outputPath, {
      name: "T",
      author: "A",
      publisherId: "550e8400-e29b-41d4-a716-446655440001",
      version: "1.0.0",
    })

    const handlers = makeHandlers()
    await installCommand({ source: outputPath }, handlers)

    const warnCalls = (handlers.toast.warning as ReturnType<typeof mock>).mock.calls
    expect(warnCalls.some((c: string[]) => c[0].includes("unsigned"))).toBe(true)
    const successCalls = (handlers.toast.success as ReturnType<typeof mock>).mock.calls
    expect(successCalls.length).toBe(1)
    expect(successCalls[0][0]).toContain("installed")
  })

  test("calls onInstalled with the team config", async () => {
    const outputPath = path.join(tmpDir, "installed-team.manifest.json")
    await publishManifest(fixtureTeam(), outputPath, {
      name: "T",
      author: "A",
      publisherId: "550e8400-e29b-41d4-a716-446655440002",
      version: "1.0.0",
    })

    const handlers = makeHandlers()
    await installCommand({ source: outputPath }, handlers)

    const installedCalls = (handlers.onInstalled as ReturnType<typeof mock>).mock.calls
    expect(installedCalls.length).toBe(1)
    expect(installedCalls[0][0]).toBeDefined()
  })

  test("calls toast.error for TeamPublisherNotTrusted (signed manifest, publisher not trusted)", async () => {
    const { privateKey } = generateKeyPair()
    const outputPath = path.join(tmpDir, "signed-untrusted.manifest.json")
    await publishManifest(fixtureTeam(), outputPath, {
      name: "T",
      author: "A",
      publisherId: "550e8400-e29b-41d4-a716-446655440003",
      version: "1.0.0",
      privateKey,
    })

    const handlers = makeHandlers()
    await installCommand({ source: outputPath }, handlers)

    const errorCalls = (handlers.toast.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.length).toBe(1)
    expect(errorCalls[0][0]).toContain("not trusted")
  })

  test("calls toast.error for invalid manifest JSON", async () => {
    const badPath = path.join(tmpDir, "bad.json")
    await fs.writeFile(badPath, "{ not json ]}", "utf-8")

    const handlers = makeHandlers()
    await installCommand({ source: badPath }, handlers)

    const errorCalls = (handlers.toast.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.length).toBe(1)
  })

  test("calls toast.error for schema-invalid manifest", async () => {
    const badPath = path.join(tmpDir, "invalid-schema.json")
    await fs.writeFile(badPath, JSON.stringify({ manifestVersion: "99.0", garbage: true }), "utf-8")

    const handlers = makeHandlers()
    await installCommand({ source: badPath }, handlers)

    const errorCalls = (handlers.toast.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.length).toBe(1)
    expect(errorCalls[0][0]).toContain("Invalid manifest")
  })

  test("requireSignature: true rejects unsigned manifest with signature error toast", async () => {
    const outputPath = path.join(tmpDir, "unsigned-required.manifest.json")
    await publishManifest(fixtureTeam(), outputPath, {
      name: "T",
      author: "A",
      publisherId: "550e8400-e29b-41d4-a716-446655440004",
      version: "1.0.0",
      // no privateKey — unsigned
    })

    const handlers = makeHandlers()
    await installCommand({ source: outputPath, requireSignature: true }, handlers)

    const errorCalls = (handlers.toast.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.length).toBe(1)
    expect(errorCalls[0][0].toLowerCase()).toContain("signature")
    const successCalls = (handlers.toast.success as ReturnType<typeof mock>).mock.calls
    expect(successCalls.length).toBe(0)
  })

  test("requireSignature: false accepts unsigned manifest with warning (same as omitting option)", async () => {
    const outputPath = path.join(tmpDir, "unsigned-ok.manifest.json")
    await publishManifest(fixtureTeam(), outputPath, {
      name: "T",
      author: "A",
      publisherId: "550e8400-e29b-41d4-a716-446655440005",
      version: "1.0.0",
    })

    const handlers = makeHandlers()
    await installCommand({ source: outputPath, requireSignature: false }, handlers)

    const warnCalls = (handlers.toast.warning as ReturnType<typeof mock>).mock.calls
    expect(warnCalls.some((c: string[]) => c[0].includes("unsigned"))).toBe(true)
    const successCalls = (handlers.toast.success as ReturnType<typeof mock>).mock.calls
    expect(successCalls.length).toBe(1)
  })
})

// ─── trustCommand ────────────────────────────────────────────────────────────

describe("trustCommand", () => {
  test("calls toast.success after adding publisher", async () => {
    const { publicKey } = generateKeyPair()
    const keyFile = path.join(tmpDir, "pub.pem")
    await fs.writeFile(keyFile, publicKey, "utf-8")

    const handlers = makeHandlers()
    await trustCommand({ keyFile, publisherId: "test-pub-id" }, handlers)

    const successCalls = (handlers.toast.success as ReturnType<typeof mock>).mock.calls
    expect(successCalls.length).toBe(1)
    expect(successCalls[0][0]).toContain("test-pub-id")
  })

  test("calls toast.error if key file does not exist", async () => {
    const handlers = makeHandlers()
    await trustCommand({ keyFile: path.join(tmpDir, "missing.pem"), publisherId: "x" }, handlers)

    const errorCalls = (handlers.toast.error as ReturnType<typeof mock>).mock.calls
    expect(errorCalls.length).toBe(1)
    expect(errorCalls[0][0]).toContain("Trust failed:")
  })
})

// ─── untrustCommand ──────────────────────────────────────────────────────────

describe("untrustCommand", () => {
  test("calls toast.warning when publisher not in trust store", async () => {
    const handlers = makeHandlers()
    await untrustCommand({ publisherId: "nonexistent-publisher" }, handlers)

    const warnCalls = (handlers.toast.warning as ReturnType<typeof mock>).mock.calls
    expect(warnCalls.length).toBe(1)
    expect(warnCalls[0][0]).toContain("not in the trust store")
  })
})

// ─── registerTeamRegistryCommands ────────────────────────────────────────────

describe("registerTeamRegistryCommands", () => {
  test("returns a cleanup function that calls all deregisters", () => {
    const unregister1 = mock(() => {})
    const unregister2 = mock(() => {})
    const unregister3 = mock(() => {})
    const unregister4 = mock(() => {})

    let callCount = 0
    const unregisters = [unregister1, unregister2, unregister3, unregister4]

    const register = mock((_cmd: Command) => {
      const fn = unregisters[callCount++]
      return fn!
    })

    const handlers = makeHandlers()
    const cleanup = registerTeamRegistryCommands(register as any, handlers)

    // 4 commands registered
    expect((register as ReturnType<typeof mock>).mock.calls.length).toBe(4)

    cleanup()

    expect(unregister1.mock.calls.length).toBe(1)
    expect(unregister2.mock.calls.length).toBe(1)
    expect(unregister3.mock.calls.length).toBe(1)
    expect(unregister4.mock.calls.length).toBe(1)
  })

  test("registered commands have correct IDs", () => {
    const registeredIds: string[] = []
    const register = mock((cmd: Command) => {
      registeredIds.push(cmd.id)
      return mock(() => {})
    })

    const handlers = makeHandlers()
    registerTeamRegistryCommands(register as any, handlers)

    expect(registeredIds).toContain("workflow.team.publish")
    expect(registeredIds).toContain("workflow.team.install")
    expect(registeredIds).toContain("workflow.team.trust")
    expect(registeredIds).toContain("workflow.team.untrust")
  })
})
