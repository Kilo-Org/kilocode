import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"

const record = z.object({
  name: z.string().regex(/^\.kilo-cutover-[A-Za-z0-9]{6}$/),
  directory: z.string(),
  original: z.string(),
  linking: z.boolean(),
})
type Record = z.infer<typeof record>

export function identity(file: string) {
  const stat = fs.lstatSync(file, { bigint: true })
  return `${stat.dev}:${stat.ino}`
}

export function beginStage(journal: string, source: string, scratch: string) {
  const value = {
    name: path.basename(scratch),
    directory: identity(scratch),
    original: identity(source),
    linking: false,
  }
  write(journal, value, true)
  return () => write(journal, { ...value, linking: true }, false)
}

function write(journal: string, value: Record, first: boolean) {
  const temp = `${journal}.${randomUUID()}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value), { flag: "wx", mode: 0o600, flush: true })
  try {
    if (first) fs.linkSync(temp, journal)
    else fs.renameSync(temp, journal)
    syncDir(path.dirname(journal))
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

export function recordedStage(journal: string, original: string) {
  const stat = fs.lstatSync(journal, { throwIfNoEntry: false })
  if (!stat) return
  if (!stat.isFile() || stat.uid !== process.geteuid?.() || stat.mode & 0o077)
    throw new Error(`Untrusted staging journal: ${journal}`)
  const value = record.parse(JSON.parse(fs.readFileSync(journal, "utf8")))
  if (identity(original) !== value.original)
    throw new Error(`Original database does not match staging journal: ${journal}`)
  const dir = path.join(fs.realpathSync.native(path.dirname(original)), value.name)
  const stage = fs.lstatSync(dir, { throwIfNoEntry: false })
  if (
    stage &&
    (!stage.isDirectory() || stage.uid !== stat.uid || stage.mode & 0o077 || identity(dir) !== value.directory)
  )
    throw new Error(`Staging directory was replaced: ${dir}`)
  return {
    linking: value.linking,
    remove() {
      if (stage) {
        fs.rmSync(dir, { recursive: true })
        syncDir(path.dirname(dir))
      }
      fs.unlinkSync(journal)
      syncDir(path.dirname(journal))
    },
  }
}

export function syncDir(dir: string) {
  if (process.platform === "win32") return
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
