import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { UpsellPreferences } from "../../src/kilo-provider/upsell-preferences"
import type { UpsellAction, UpsellState } from "../../src/shared/agent-manager-upsell"

const dirs: string[] = []
const children: ReturnType<typeof Bun.spawn>[] = []
const NOW = 10_000
const WEEK = 7 * 24 * 60 * 60 * 1000

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      child.kill()
      await child.exited
    }),
  )
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function storage() {
  const dir = await mkdtemp(join(tmpdir(), "kilo-upsell-process-"))
  dirs.push(dir)
  return dir
}

async function worker(dir: string) {
  const pending = new Map<string, ReturnType<typeof Promise.withResolvers<unknown>>>()
  const ready = Promise.withResolvers<unknown>()
  pending.set("ready", ready)
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../fixtures/upsell-preferences.ts"), dir], {
    stdout: "ignore",
    stderr: "pipe",
    ipc(message: { id: string; result?: unknown; error?: string }) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) entry?.reject(new Error(message.error))
      else entry?.resolve(message.result)
    },
  })
  children.push(child)
  void child.exited.then(async (code) => {
    if (!pending.size) return
    const error = new Error(`Upsell worker exited (${code}): ${await new Response(child.stderr).text()}`)
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  })
  const shown = await ready.promise
  return {
    child,
    shown,
    run(action: UpsellAction | "load" | "observed" | "orphan", now = NOW, count = 1) {
      const id = crypto.randomUUID()
      const entry = Promise.withResolvers<unknown>()
      pending.set(id, entry)
      child.send({ id, action, now, count })
      return entry.promise as Promise<{ state: UpsellState; engaged: boolean; display: boolean }>
    },
  }
}

describe("authoritative Agent Manager upsell preferences", () => {
  it("reads a fresh profile without creating storage", async () => {
    const dir = await storage()
    expect(await new UpsellPreferences(dir).read()).toEqual({})
    expect(await readdir(dir)).toEqual([])
  })

  it("preserves opt-out against an already-shown separate host snoozing, until explicit Undo", async () => {
    const dir = await storage()
    const [first, second] = await Promise.all([worker(dir), worker(dir)])
    expect(first.child.pid).not.toBe(second.child.pid)
    expect([first.shown, second.shown]).toEqual([true, true])
    await Promise.all([first.run("dont_show_again"), second.run("not_now")])
    const prefs = new UpsellPreferences(dir)
    expect(await prefs.read()).toEqual({ optedOut: true, snoozeCount: 1, snoozedAt: NOW })
    expect((await second.run("load", NOW + 100 * WEEK)).state.optedOut).toBe(true)
    const third = await worker(dir)
    expect(third.shown).toBe(false)
    expect((await third.run("shown", NOW + WEEK)).display).toBe(false)
    expect((await first.run("undo", NOW + WEEK)).state).toEqual({ optedOut: false, snoozeCount: 1, snoozedAt: NOW })
    expect((await third.run("shown", NOW + WEEK)).display).toBe(true)
  })

  it("does not collapse two simultaneous snoozes from separate already-shown hosts", async () => {
    const dir = await storage()
    const [first, second] = await Promise.all([worker(dir), worker(dir)])
    expect([first.shown, second.shown]).toEqual([true, true])
    const results = await Promise.all([first.run("not_now"), second.run("not_now")])
    expect(results.map((result) => result.state.snoozeCount).sort()).toEqual([1, 2])
    expect(await new UpsellPreferences(dir).read()).toEqual({ snoozeCount: 2, snoozedAt: NOW })
  })

  it("caps contended snoozes losslessly at three and never shortens a newer snooze", async () => {
    const dir = await storage()
    const hosts = await Promise.all(Array.from({ length: 8 }, () => worker(dir)))
    expect(hosts.every((host) => host.shown)).toBe(true)
    const results = await Promise.all(hosts.map((host) => host.run("not_now")))
    expect(results.map((result) => result.state.snoozeCount).sort()).toEqual([1, 2, 3, 3, 3, 3, 3, 3])
    const prefs = new UpsellPreferences(dir)
    expect(await prefs.read()).toEqual({ snoozeCount: 3, snoozedAt: NOW })
    expect((await hosts.at(0)!.run("shown", NOW + 100 * WEEK)).display).toBe(false)
    expect(await readdir(join(dir, "agent-manager-upsell"))).toHaveLength(3)
    const fresh = await storage()
    await new UpsellPreferences(fresh).update("not_now", NOW + WEEK)
    await new UpsellPreferences(fresh).update("not_now", NOW)
    expect(await new UpsellPreferences(fresh).read()).toEqual({ snoozeCount: 2, snoozedAt: NOW + WEEK })
  })

  it("retains only one routine opened revision across hosts and later restarts", async () => {
    const dir = await storage()
    const hosts = await Promise.all(Array.from({ length: 4 }, () => worker(dir)))
    await Promise.all(hosts.map((host) => host.run("observed", NOW, 40)))
    const restarted = await worker(dir)
    expect(restarted.shown).toBe(false)
    await restarted.run("observed", NOW, 40)
    expect(await new UpsellPreferences(dir).read()).toEqual({ opened: true })
    expect(await readdir(join(dir, "agent-manager-upsell"))).toEqual(["1.json"])
  })

  it("merges opening, conversion, snooze and opt-out from distinct processes", async () => {
    const dir = await storage()
    const hosts = await Promise.all(Array.from({ length: 4 }, () => worker(dir)))
    await Promise.all([
      hosts.at(0)!.run("observed"),
      hosts.at(1)!.run("opened"),
      hosts.at(2)!.run("not_now"),
      hosts.at(3)!.run("dont_show_again"),
    ])
    expect(await new UpsellPreferences(dir).read()).toEqual({
      opened: true,
      converted: true,
      snoozeCount: 1,
      snoozedAt: NOW,
      optedOut: true,
    })
    await hosts.at(0)!.run("undo", NOW + WEEK)
    const restarted = await worker(dir)
    expect(restarted.shown).toBe(false)
  })

  it("recovers immediately after a writer dies, ignoring incomplete unpublished staging", async () => {
    const dir = await storage()
    const first = await worker(dir)
    await first.run("dont_show_again")
    await first.run("orphan")
    first.child.kill("SIGKILL")
    await first.child.exited
    const second = await worker(dir)
    expect(second.shown).toBe(false)
    await second.run("not_now")
    expect(await new UpsellPreferences(dir).read()).toEqual({ optedOut: true, snoozeCount: 1, snoozedAt: NOW })
    const journal = join(dir, "agent-manager-upsell")
    expect(await readFile(join(journal, "1.json"), "utf8")).toBe('{"optedOut":true}')
    expect((await readdir(journal)).sort()).toEqual([".interrupted.tmp", "1.json", "2.json"])
  })

  it("fails closed rather than resetting a corrupt committed revision", async () => {
    const dir = await storage()
    const prefs = new UpsellPreferences(dir)
    await prefs.update("dont_show_again", NOW)
    await writeFile(join(dir, "agent-manager-upsell", "1.json"), '{"optedOut":')
    await expect(prefs.read()).rejects.toThrow()
    await expect(prefs.update("not_now", NOW)).rejects.toThrow()
    expect(await readdir(join(dir, "agent-manager-upsell"))).toEqual(["1.json"])
  })
})
