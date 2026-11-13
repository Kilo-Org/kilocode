import { afterAll, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionID } from "@opencode/schema/session-id"
import * as SandboxState from "../../src/sandbox/state"
import { SandboxPreference } from "../../src/sandbox/preference"
import { root } from "../../src/sandbox/root"
import { SandboxStore } from "../../src/sandbox/store"
import { addSession, cleanup, harness, provide, session, tempdir } from "./support"

afterAll(cleanup)

const id = (value: string) => value as SessionID

async function files(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(directory, entry.name)
        return entry.isDirectory() ? files(target) : [target]
      }),
    )
  ).flat()
}

describe("sandbox session metadata", () => {
  test("uses the kilocode.sandbox metadata key", () => {
    expect(SandboxState.key).toBe("kilocode.sandbox")
  })

  test("parses a valid create-time choice", () => {
    expect(SandboxState.parse({ "kilocode.sandbox": { enabled: true, version: 0 } })).toEqual({
      enabled: true,
      version: 0,
    })
    expect(SandboxState.parse({ "kilocode.sandbox": { enabled: false, version: 3 } })).toEqual({
      enabled: false,
      version: 3,
    })
  })

  test("ignores malformed choices", () => {
    for (const metadata of [
      undefined,
      null,
      {},
      { "kilocode.sandbox": null },
      { "kilocode.sandbox": [] },
      { "kilocode.sandbox": "on" },
      { "kilocode.sandbox": { enabled: "yes", version: 0 } },
      { "kilocode.sandbox": { enabled: true } },
      { "kilocode.sandbox": { enabled: true, version: -1 } },
      { "kilocode.sandbox": { enabled: true, version: 1.5 } },
      { "kilocode.sandbox": { enabled: true, version: "1" } },
    ]) {
      expect(SandboxState.parse(metadata)).toBeUndefined()
    }
  })

  test("reads the choice from the session metadata through the runtime", async () => {
    const directory = await tempdir()
    const value = harness({ directory })
    const chosen = addSession(
      value,
      session("ses_state_metadata", directory, { metadata: { "kilocode.sandbox": { enabled: true, version: 2 } } }),
    )
    const plain = addSession(value, session("ses_state_metadata_plain", directory))

    expect(await Effect.runPromise(provide(value, SandboxState.read(chosen.id)))).toEqual({
      enabled: true,
      version: 2,
    })
    expect(await Effect.runPromise(provide(value, SandboxState.read(plain.id)))).toBeUndefined()
    expect(await Effect.runPromise(provide(value, SandboxState.read(id("ses_state_missing"))))).toBeUndefined()
  })
})

describe("sandbox policy store", () => {
  test("stores policy state under the sandbox state directory", () => {
    expect(root).toBe(path.join(realpathSync.native(Global.Path.state), "sandbox"))
    expect(SandboxStore.root).toBe(path.join(root, "policy"))
    expect(SandboxPreference.root).toBe(path.join(root, "preference"))
  })

  test("round-trips a snapshot per directory and session", async () => {
    const first = await tempdir()
    const second = await tempdir()
    const sessionID = id("ses_store_roundtrip")
    const snapshot = {
      enabled: true,
      mode: "proxy" as const,
      allowedHosts: ["api.github.com:443"],
      writablePaths: ["/tmp/output"],
      version: 2,
    }

    await SandboxStore.write(first, sessionID, snapshot)
    await SandboxStore.write(second, sessionID, { ...snapshot, version: 0 })

    expect(await SandboxStore.read(first, sessionID)).toEqual(snapshot)
    expect(await SandboxStore.read(second, sessionID)).toEqual({ ...snapshot, version: 0 })
    expect(await SandboxStore.read(first, id("ses_store_absent"))).toBeUndefined()
  })

  test("rejects a stored snapshot that cannot be trusted", async () => {
    const directory = await tempdir()
    const sessionID = id("ses_store_corrupt")
    const before = new Set(await files(SandboxStore.root))
    await SandboxStore.write(directory, sessionID, {
      enabled: false,
      mode: "deny",
      allowedHosts: [],
      writablePaths: [],
      version: 0,
    })
    const stored = (await files(SandboxStore.root)).find((file) => !before.has(file))
    if (!stored) throw new Error("stored snapshot was not written")

    await fs.writeFile(
      stored,
      JSON.stringify({ enabled: true, mode: "proxy", allowedHosts: [], writablePaths: [], version: 0 }),
    )
    await expect(SandboxStore.read(directory, sessionID)).rejects.toThrow("Invalid sandbox policy state")

    await fs.writeFile(stored, "not json")
    await expect(SandboxStore.read(directory, sessionID)).rejects.toThrow()
  })

  test("removes one session snapshot and disposes every directory snapshot", async () => {
    const first = await tempdir()
    const second = await tempdir()
    const sessionID = id("ses_store_remove")
    const snapshot = { enabled: true, mode: "deny" as const, allowedHosts: [], writablePaths: [], version: 1 }
    await SandboxStore.write(first, sessionID, snapshot)
    await SandboxStore.write(second, sessionID, snapshot)

    await SandboxStore.remove(first, sessionID)
    expect(await SandboxStore.read(first, sessionID)).toBeUndefined()
    expect(await SandboxStore.read(second, sessionID)).toEqual(snapshot)

    await SandboxStore.dispose(sessionID)
    expect(await SandboxStore.read(second, sessionID)).toBeUndefined()
  })
})

describe("sandbox directory preference", () => {
  test("round-trips the last toggle for a directory", async () => {
    const directory = await tempdir()
    expect(await SandboxPreference.read(directory)).toBeUndefined()

    await SandboxPreference.write(directory, true)
    expect(await SandboxPreference.read(directory)).toBe(true)

    await SandboxPreference.write(directory, false)
    expect(await SandboxPreference.read(directory)).toBe(false)
    expect(await SandboxPreference.read(`${directory}-other`)).toBeUndefined()
  })

  test("ignores a preference file that is not a boolean", async () => {
    const directory = await tempdir()
    const before = new Set(await files(SandboxPreference.root))
    await SandboxPreference.write(directory, true)
    const stored = (await files(SandboxPreference.root)).find((file) => !before.has(file))
    if (!stored) throw new Error("preference was not written")

    await fs.writeFile(stored, JSON.stringify("on"))
    expect(await SandboxPreference.read(directory)).toBeUndefined()
  })
})
