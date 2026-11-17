// Hub registry: one small JSON file per running hub inside the run dir, so a CLI
// can find a reachable hub without knowing how it was started.
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Log } from "@opencode-ai/core/util/log"
import { Paths } from "./paths"

const log = Log.create({ service: "browser.registry" })

export namespace Registry {
  export const Entry = z.object({
    hubId: z.uuid(),
    mode: z.enum(["native", "loopback"]),
    browser: z.object({ name: z.string(), version: z.string() }).nullable(),
    profileLabel: z.string().nullable(),
    socket: z.string(),
    pid: z.number().int().positive(),
    protocol: z.array(z.number().int()).min(1),
  })
  export type Entry = z.infer<typeof Entry>

  export const empty = (input: { hubId: string; mode: Entry["mode"]; socket: string; pid?: number }): Entry => ({
    hubId: input.hubId,
    mode: input.mode,
    browser: null,
    profileLabel: null,
    socket: input.socket,
    pid: input.pid ?? process.pid,
    protocol: [1],
  })

  export async function write(entry: Entry, dir = Paths.hubs()) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const target = path.join(dir, `${entry.hubId}.json`)
    const temp = `${target}.${process.pid}.tmp`
    // 0600: the socket path alone reaches the hub, but the file also carries the
    // browser label and PID, so keep it private to the user.
    await fs.writeFile(temp, JSON.stringify(entry, null, 2), { mode: 0o600 })
    await fs.rename(temp, target)
  }

  export async function remove(hubId: string, dir = Paths.hubs()) {
    await fs.rm(path.join(dir, `${hubId}.json`), { force: true })
  }

  export function alive(pid: number) {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      // EPERM means the process exists under another user; only a missing PID is proof of death.
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
      return code === "EPERM"
    }
  }

  async function read(file: string) {
    const text = await fs.readFile(file, "utf8").catch((error) => {
      log.warn("cannot read hub entry", { file, error })
      return undefined
    })
    if (text === undefined) return undefined
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      log.warn("hub entry is not valid JSON", { file, error })
      return undefined
    }
    return Entry.safeParse(value)
  }

  // Reads the registry, deleting entries that are unreadable or whose hub process is gone.
  export async function list(input: { dir?: string; alive?: (pid: number) => boolean; clean?: boolean } = {}) {
    const dir = input.dir ?? Paths.hubs()
    const probe = input.alive ?? alive
    const clean = input.clean ?? true
    const names = await fs.readdir(dir).catch(() => [] as string[])
    const entries: Entry[] = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      const file = path.join(dir, name)
      const parsed = await read(file)
      if (parsed === undefined || !parsed.success) {
        log.warn("removing unreadable hub entry", { file })
        if (clean) await fs.rm(file, { force: true })
        continue
      }
      if (!probe(parsed.data.pid)) {
        log.info("removing stale hub entry", { file, pid: parsed.data.pid })
        if (clean) await fs.rm(file, { force: true })
        continue
      }
      entries.push(parsed.data)
    }
    // Native first, then loopback: a browser-started hub outlives a detached one.
    return entries.sort((a, b) => (a.mode === "native" ? 0 : 1) - (b.mode === "native" ? 0 : 1))
  }
}
