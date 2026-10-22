import { randomUUID } from "node:crypto"
import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import { localBwrapDigest, localBwrapPath, validLocalBwrap } from "../src/services/cli-backend/cli-resources"

export function currentBwrapTarget(): string {
  const os = process.platform === "win32" ? "win32" : process.platform
  return `${os}-${process.arch}`
}

function arch(target: string): "x64" | "arm64" {
  if (target === "linux-x64") return "x64"
  if (target === "linux-arm64") return "arm64"
  throw new Error(`No Bubblewrap helper configured for target ${target}`)
}

function source() {
  const configured = process.env.KILO_BWRAP_PATH
  if (configured) return realpathSync(configured)

  const found = Bun.which("bwrap")
  if (!found) return
  const target = realpathSync(found)
  const entry = statSync(target)
  const uid = process.getuid?.()
  const groups = process.getgroups?.() ?? []
  const writable =
    (entry.mode & 0o002) !== 0 ||
    (uid !== undefined && entry.uid === uid && (entry.mode & 0o200) !== 0) ||
    (groups.includes(entry.gid) && (entry.mode & 0o020) !== 0)
  if (writable) {
    throw new Error(`Refusing writable Bubblewrap executable at ${target}; set KILO_BWRAP_PATH to trust it explicitly`)
  }
  return target
}

function secure(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const entry = lstatSync(dir)
  if (
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    entry.uid !== process.getuid?.() ||
    (entry.mode & 0o077) !== 0
  ) {
    throw new Error(`Bubblewrap cache directory is not private: ${dir}`)
  }
}

function stage(source: string, dest: string, digest: string) {
  const root = dirname(dirname(dest))
  const dir = dirname(dest)
  secure(root)
  secure(dir)

  const token = `${process.pid}-${randomUUID()}`
  const executable = `${dest}.${token}.tmp`
  const checksum = `${executable}.sha256`
  try {
    copyFileSync(source, executable, constants.COPYFILE_EXCL)
    chmodSync(executable, 0o755)
    writeFileSync(checksum, `${digest}\n`, { flag: "wx", mode: 0o600 })
    renameSync(executable, dest)
    renameSync(checksum, `${dest}.sha256`)
  } finally {
    rmSync(executable, { force: true })
    rmSync(checksum, { force: true })
  }

  if (!validLocalBwrap(dest)) throw new Error(`Could not validate staged Bubblewrap executable at ${dest}`)
}

export async function ensureBwrapForTarget(target: string, root?: string): Promise<string | undefined> {
  const dest = localBwrapPath(target, root)
  if (!dest) return

  const executable = source()
  if (executable) {
    const digest = localBwrapDigest(executable)
    if (validLocalBwrap(dest) && localBwrapDigest(dest) === digest) return dest
    stage(executable, dest, digest)
    return dest
  }
  if (validLocalBwrap(dest)) return dest

  const { buildBubblewrap } = await import("../../opencode/script/kilocode/bubblewrap")
  const built = await buildBubblewrap(arch(target))
  stage(built.executable, dest, built.digest)
  return dest
}
