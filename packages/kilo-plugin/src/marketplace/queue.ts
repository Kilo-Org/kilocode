export * as Queue from "./queue"

import fs from "node:fs/promises"
import path from "node:path"

// One queue per canonical target, shared by every marketplace module, so a cleanup cannot delete another
// operation's live rollback backup. Other processes are not covered.
const queues = new Map<string, Promise<unknown>>()

/** Run `task` on the canonical path, serialized with every other operation on the same target. */
export function serialized<A>(target: string, task: (target: string) => Promise<A>) {
  return canonical(target).then((canonical) => {
    const run = (queues.get(canonical) ?? Promise.resolve()).catch(() => undefined).then(() => task(canonical))
    queues.set(canonical, run)
    return run.finally(() => {
      if (queues.get(canonical) === run) queues.delete(canonical)
    })
  })
}

/** Resolve the parent so aliases of one target share a queue; the file itself may not exist yet. */
async function canonical(target: string): Promise<string> {
  const absolute = path.resolve(target)
  return path.join(await resolveDirectory(path.dirname(absolute)), path.basename(absolute))
}

async function resolveDirectory(directory: string): Promise<string> {
  return fs.realpath(directory).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    return path.join(await resolveDirectory(path.dirname(directory)), path.basename(directory))
  })
}
