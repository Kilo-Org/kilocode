import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import z from "zod"

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProtocolError"
  }
}

export async function ensureDir(dir: string, mode = 0o700) {
  await mkdir(dir, { recursive: true, mode })
  await restrict(dir, mode)
}

export class DirExistsError extends Error {}

export async function claimDir(dir: string, mode = 0o700) {
  try {
    await mkdir(dir, { recursive: false, mode })
  } catch (error) {
    if (isExists(error)) throw new DirExistsError(`${dir} already exists`)
    throw error
  }
  await restrict(dir, mode)
}

function isExists(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "EEXIST"
}

async function restrict(target: string, mode: number) {
  if (process.platform === "win32") return
  await chmod(target, mode)
}

export async function writeJson(file: string, value: unknown, mode = 0o600) {
  await ensureDir(dirname(file))
  const data = `${JSON.stringify(value, null, 2)}\n`
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, data, { mode })
  await restrict(tmp, mode)
  await rename(tmp, file)
}

export async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, "utf8")
  try {
    return JSON.parse(text)
  } catch {
    throw new ProtocolError(`invalid JSON at ${file}`)
  }
}

export async function readJsonAs<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readJson(file))
  if (!parsed.success) throw new ProtocolError(`document at ${file} does not match its schema`)
  return parsed.data
}

export async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  )
}

export async function remove(file: string) {
  await rm(file, { force: true })
}
