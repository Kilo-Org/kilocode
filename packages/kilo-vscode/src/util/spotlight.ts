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
