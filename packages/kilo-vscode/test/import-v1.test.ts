import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Memento, StatusBarItem } from "vscode"
import { createMigration, importLine, probe, routeV1Import } from "../src/import-v1"
import type { ToWebview, V1ImportState } from "../src/protocol"
import type { Command } from "../src/server"

test("the conversion counter is read from the import output", () => {
  expect(importLine("Importing Kilo v1 sessions 42/100")).toEqual({ imported: 42, total: 100 })
  expect(importLine("Importing the Kilo v1 sessions of /tmp/kilo.db")).toBeUndefined()
  expect(importLine("Imported 42 Kilo v1 sessions from /a to /b in 5 ms.")).toBeUndefined()
})

test("the probe reads the store state the CLI prints", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-probe-"))
  const script = path.join(dir, "probe.ts")
  await writeFile(script, print({ source: "/data/kilo/kilo.db", sourceSessions: 7, target: "/data/kilo2/kilo2-v2.db" }))
  const found = await probe({ cmd: process.execPath, args: [script], env: { KILO_V2_PROFILE: dir } }, process.env)
  await rm(dir, { recursive: true, force: true })
  expect(found).toEqual({
    source: "/data/kilo/kilo.db",
    sourceSessions: 7,
    target: "/data/kilo2/kilo2-v2.db",
    targetSessions: 0,
  })
})

test("a probe that prints nothing is treated as no Kilo v1 store", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-probe-"))
  const script = path.join(dir, "probe.ts")
  await writeFile(script, "0")
  expect(
    await probe({ cmd: process.execPath, args: [script], env: { KILO_V2_PROFILE: dir } }, process.env),
  ).toBeUndefined()
  await rm(dir, { recursive: true, force: true })
})

test("no command means no state, so the entry stays hidden", async () => {
  expect(await probe(undefined, {})).toBeUndefined()
})

function print(value: object) {
  return `process.stdout.write(${JSON.stringify(JSON.stringify(value))})`
}

/** A fake CLI that answers the status probe with `state`, in the dev entry shape the probe calls. */
async function cli(state: object) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-probe-"))
  await writeFile(path.join(dir, "probe.ts"), print(state))
  return { dir, command: { cmd: process.execPath, args: [path.join(dir, "probe.ts")], env: { KILO_V2_PROFILE: dir } } }
}

function migration(
  command: Command,
  sent: V1ImportState[] = [],
  stop: () => Promise<unknown> | undefined = () => undefined,
) {
  const values = new Map<string, unknown>()
  return createMigration({
    command: () => command,
    env: process.env,
    log: () => {},
    status: { show() {}, hide() {} } as unknown as StatusBarItem,
    memento: {
      get: (key: string) => values.get(key),
      update: async (key: string, value: unknown) => void values.set(key, value),
    } as unknown as Memento,
    stop,
    notify: (state) => sent.push(state),
  })
}

test("a first start with Kilo v1 sessions holds the server until the user chooses", async () => {
  const fake = await cli({ source: "/v1/kilo.db", sourceSessions: 3, target: "/v2/kilo2.db", targetSessions: 0 })
  const sent: V1ImportState[] = []
  const host = migration(fake.command, sent)
  host.activate()
  const idle = { done: false }
  void host.idle().then(() => (idle.done = true))
  await Bun.sleep(1_000)
  expect(idle.done).toBe(false)
  expect(sent.at(-1)).toMatchObject({ phase: "available", sourceSessions: 3, waiting: true })
  await host.later()
  await host.idle()
  expect(host.state()).toMatchObject({ phase: "available", waiting: false, dismissed: true })
  await rm(fake.dir, { recursive: true, force: true })
})

test("existing Kilo v2 sessions never hold the server", async () => {
  const fake = await cli({ source: "/v1/kilo.db", sourceSessions: 3, target: "/v2/kilo2.db", targetSessions: 5 })
  const host = migration(fake.command)
  host.activate()
  await host.idle()
  expect(host.state()).toMatchObject({ phase: "available", targetSessions: 5, waiting: false })
  await rm(fake.dir, { recursive: true, force: true })
})

test("the card messages reach the import, and a loaded webview receives the current state", async () => {
  const fake = await cli({ source: "/v1/kilo.db", sourceSessions: 0, target: "/v2/kilo2.db" })
  const host = migration(fake.command)
  const posted: ToWebview[] = []
  expect(routeV1Import({ type: "v1Import.request" }, host, (message) => posted.push(message))).toBe(true)
  expect(posted).toEqual([{ type: "v1Import.state", state: { phase: "none" } }])
  expect(routeV1Import({ type: "requestGitChangesStats" }, host, () => {})).toBe(false)
  expect(routeV1Import({ type: "v1Import.request" }, undefined, () => {})).toBe(false)
  await rm(fake.dir, { recursive: true, force: true })
})

test("a server requested while the import stops the old one waits until the import has finished", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-gate-"))
  const target = path.join(dir, "kilo2.db")
  await writeFile(target, "")
  // Existing v2 sessions: nothing holds the server at activation, as after a declined or failed first import.
  const fake = await cli({ source: "/v1/kilo.db", sourceSessions: 3, target, targetSessions: 2 })
  const order: string[] = []
  const sent: V1ImportState[] = []
  const host = migration(fake.command, sent, () => {
    // The real stop handlers ask for a new server synchronously, before the import has started.
    void host.idle().then(() => order.push("server"))
    return Promise.resolve()
  })
  host.activate()
  await Bun.sleep(1_000)
  await host.start()
  order.push(sent.at(-1)?.phase ?? "")
  await Bun.sleep(10)
  expect(order).toEqual(["done", "server"])
  await rm(dir, { recursive: true, force: true })
  await rm(fake.dir, { recursive: true, force: true })
})
