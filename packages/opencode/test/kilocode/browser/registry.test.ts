import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Registry } from "../../../src/kilocode/browser/registry"

async function dir() {
  return fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "kilo-registry-"))
}

const hubId = "6f1c2f7e-0d3f-4b1f-8a54-9d0e7a1c2b3d"

describe("hub registry", () => {
  test("writes and reads an entry with 0600", async () => {
    const at = await dir()
    await Registry.write(Registry.empty({ hubId, mode: "native", socket: "/tmp/x.sock", pid: 42 }), at)
    const file = path.join(at, `${hubId}.json`)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    const entries = await Registry.list({ dir: at, alive: () => true })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.mode).toBe("native")
    expect(entries[0]?.socket).toBe("/tmp/x.sock")
    await fs.rm(at, { recursive: true, force: true })
  })

  test("removes entries whose hub process is gone", async () => {
    const at = await dir()
    await Registry.write(Registry.empty({ hubId, mode: "loopback", socket: "/tmp/x.sock", pid: 42 }), at)
    const entries = await Registry.list({ dir: at, alive: () => false })
    expect(entries).toHaveLength(0)
    expect(await fs.readdir(at)).toStrictEqual([])
    await fs.rm(at, { recursive: true, force: true })
  })

  test("removes entries that do not parse", async () => {
    const at = await dir()
    await fs.writeFile(path.join(at, `${hubId}.json`), "{")
    const entries = await Registry.list({ dir: at, alive: () => true })
    expect(entries).toHaveLength(0)
    expect(await fs.readdir(at)).toStrictEqual([])
    await fs.rm(at, { recursive: true, force: true })
  })

  test("keeps stale entries when cleaning is off", async () => {
    const at = await dir()
    await Registry.write(Registry.empty({ hubId, mode: "native", socket: "/tmp/x.sock", pid: 42 }), at)
    await Registry.list({ dir: at, alive: () => false, clean: false })
    expect(await fs.readdir(at)).toHaveLength(1)
    await fs.rm(at, { recursive: true, force: true })
  })

  test("lists native hubs before loopback hubs", async () => {
    const at = await dir()
    await Registry.write(
      Registry.empty({ hubId: "11111111-1111-4111-8111-111111111111", mode: "loopback", socket: "/tmp/l" }),
      at,
    )
    await Registry.write(
      Registry.empty({ hubId: "22222222-2222-4222-8222-222222222222", mode: "native", socket: "/tmp/n" }),
      at,
    )
    const entries = await Registry.list({ dir: at, alive: () => true })
    expect(entries.map((entry) => entry.mode)).toStrictEqual(["native", "loopback"])
    await fs.rm(at, { recursive: true, force: true })
  })

  test("removes an entry on request", async () => {
    const at = await dir()
    await Registry.write(Registry.empty({ hubId, mode: "native", socket: "/tmp/x.sock" }), at)
    await Registry.remove(hubId, at)
    expect(await fs.readdir(at)).toStrictEqual([])
    await fs.rm(at, { recursive: true, force: true })
  })

  test("treats the current process as alive and a missing pid as dead", () => {
    expect(Registry.alive(process.pid)).toBe(true)
    expect(Registry.alive(2 ** 22 + 12345)).toBe(false)
  })
})
