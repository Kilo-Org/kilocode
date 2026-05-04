import fs from "fs/promises"
import path from "path"

const marker = ".metadata_never_index"

function exists(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  return "code" in err && err.code === "EEXIST"
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export async function markNoIndex(dir: string): Promise<void> {
  if (process.platform !== "darwin") return
  const file = path.join(dir, marker)
  await fs.writeFile(file, "", { flag: "wx" }).catch((err) => {
    if (exists(err)) return
    process.emitWarning(`Failed to mark ${dir} as Spotlight-excluded: ${message(err)}`)
  })
}
