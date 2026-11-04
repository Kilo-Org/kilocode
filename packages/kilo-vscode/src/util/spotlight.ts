import * as fs from "fs"
import * as path from "path"
function exists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = (error as { code?: unknown }).code
  return code === "EEXIST"
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const marker = ".metadata_never_index"

export async function markNoIndex(dir: string, log: (msg: string) => void): Promise<void> {
  if (process.platform !== "darwin") return
  const file = path.join(dir, marker)
  await fs.promises.writeFile(file, "", { flag: "wx" }).catch((err) => {
    if (exists(err)) return
    log(`Warning: Failed to mark ${dir} as Spotlight-excluded: ${message(err)}`)
  })
}

async function directory(dir: string): Promise<boolean> {
  return fs.promises
    .stat(dir)
    .then((stat) => stat.isDirectory())
    .catch(() => false)
}

function parent(dir: string): string | undefined {
  const parts = path.resolve(dir).split(path.sep)
  for (let i = 0; i < parts.length - 1; i++) {
    const hidden = parts[i] === ".kilo" || parts[i] === ".kilocode"
    if (hidden && parts[i + 1] === "worktrees") return parts.slice(0, i + 2).join(path.sep) || path.sep
  }
  return undefined
}

export async function markWorkspace(root: string, log: (msg: string) => void): Promise<void> {
  const ancestor = parent(root)
  if (ancestor) await markNoIndex(ancestor, log)

  for (const name of [".kilo", ".kilocode"]) {
    const dir = path.join(root, name, "worktrees")
    if (await directory(dir)) await markNoIndex(dir, log)
  }
}
