import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { clients, filename, launcher, platforms, record } from "../../../script/kilocode/npm-tarballs"
import { publishNpm } from "../../../script/kilocode/publish-npm"

const version = "0.0.0-v2-123.2"
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function release() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "npm-release-"))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  // Consumer tests receive the inventory from a build. Derive it from the fixture bytes rather
  // than starting a tar process for every package each time a consumer needs a clean directory.
  const recorded: Awaited<ReturnType<typeof record>> = []
  for (const name of [...platforms, launcher, ...clients]) {
    const archive = new Bun.Archive({ "package/package.json": JSON.stringify({ name, version }) }, { compress: "gzip" })
    const bytes = await archive.bytes()
    const file = filename(name, version)
    const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`
    await Bun.write(path.join(dir, file), bytes)
    recorded.push({ name, version, file, integrity })
  }
  const published = new Map<string, string>()
  const events: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const [name, suffix] = url.pathname.slice(1).split("/").map(decodeURIComponent)
      events.push(`GET ${decodeURIComponent(url.pathname)}`)
      if (url.pathname.includes("/-/")) return new Response("x")
      const integrity = published.get(name)
      const manifest = {
        name,
        version,
        dist: { integrity, tarball: `${url.origin}/${name}/-/${name.slice(10)}-${version}.tgz` },
      }
      if (!suffix) return Response.json({ name, versions: integrity ? { [version]: manifest } : {} })
      if (suffix === version && published.has(name)) return Response.json(manifest)
      return new Response(null, { status: 404 })
    },
  })
  cleanups.push(() => server.stop(true))

  async function npm([command, file, ...flags]: string[]) {
    expect(command).toBe("publish")
    expect(flags.slice(0, 5)).toEqual(["--ignore-scripts", "--access", "public", "--tag", "kilo-v2"])
    const bytes = await Bun.file(file).bytes()
    const files = await new Bun.Archive(bytes).files()
    const pkg = JSON.parse(await files.get("package/package.json")!.text())
    expect(pkg.version).toBe(version)
    const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`
    expect(recorded.find((entry) => entry.name === pkg.name)?.integrity).toBe(integrity)
    if (flags.includes("--dry-run")) {
      expect(flags).toContain("--offline")
      events.push(`dry-run ${pkg.name}`)
      return
    }
    expect(flags).toContain("--provenance")
    events.push(`publish ${pkg.name}`)
    published.set(pkg.name, integrity)
  }
  return {
    dir,
    recorded,
    published,
    events,
    run: (group: "client" | "cli", dryRun = false, expected = JSON.stringify(recorded)) =>
      publishNpm(group, dir, version, expected, dryRun, { registry: server.url.origin, attempts: 1 }, npm),
  }
}

test("normal release submits the recorded files; every platform is served before the launcher", async () => {
  const r = await release()
  await r.run("cli")
  expect(r.events.at(-1)).toBe(`publish ${launcher}`)
  for (const name of platforms) {
    const probe = r.events.indexOf(`GET /${name}/-/${name.slice(10)}-${version}.tgz`)
    expect(probe).toBeGreaterThan(r.events.indexOf(`publish ${name}`))
  }
  await r.run("client")
  expect(r.events.slice(-3)).toEqual(clients.map((name) => `publish ${name}`))
  expect(r.published.size).toBe(16)
  await expect(r.run("cli")).rejects.toThrow("launcher already published")
})

test("partial retries skip matching versions only, including already served platforms", async () => {
  const r = await release()
  for (const pkg of r.recorded.filter((pkg) => pkg.name === platforms[0] || pkg.name === clients[0])) {
    r.published.set(pkg.name, pkg.integrity)
  }
  await r.run("cli")
  await r.run("client")
  expect(r.events.filter((event) => event.startsWith("publish "))).toHaveLength(14)
  expect(r.events).not.toContain(`publish ${platforms[0]}`)
  expect(r.events).not.toContain(`publish ${clients[0]}`)
  expect(r.events).toContain(`GET /${platforms[0]}/-/${platforms[0].slice(10)}-${version}.tgz`)
})

test.each([platforms.at(-1)!, clients.at(-1)!])(
  "rejects a conflicting registry integrity for %s before any publish",
  async (name) => {
    const r = await release()
    r.published.set(name, "sha512-other")
    await expect(r.run(clients.includes(name) ? "client" : "cli")).rejects.toThrow("dist.integrity")
    expect(r.events.some((event) => event.startsWith("publish "))).toBe(false)
  },
)

test("both publish jobs reject an incomplete, extra or altered file before contacting npm", async () => {
  const r = await release()
  const client = path.join(r.dir, filename(clients[2], version))
  const extra = path.join(r.dir, "extra.tgz")
  await Bun.write(extra, "extra")
  await expect(r.run("client")).rejects.toThrow("Unexpected npm artifact")
  await rm(extra)
  await expect(r.run("cli", false, "")).rejects.toThrow("inventory")
  await Bun.write(client, "altered")
  await expect(r.run("cli")).rejects.toThrow("inventory")
  await rm(client)
  await expect(r.run("client")).rejects.toThrow("Missing npm artifact")
  expect(r.events).toEqual([])
})

test("the producer refuses an archive with the expected filename but different package identity", async () => {
  const r = await release()
  expect(await record(r.dir, version)).toEqual(r.recorded)
  const file = path.join(r.dir, filename(launcher, version))
  await Bun.write(file, Bun.file(path.join(r.dir, filename(clients[0], version))))
  await expect(record(r.dir, version)).rejects.toThrow(`Expected ${launcher}@${version} inside`)
})

test("dry run exercises every packed file without querying npm", async () => {
  const r = await release()
  await r.run("cli", true)
  await r.run("client", true)
  expect(r.events).toEqual([...platforms, launcher, ...clients].map((name) => `dry-run ${name}`))
  expect(r.published.size).toBe(0)
})
