import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

// A copied standalone executable may not have its macOS renderer alongside it. Only prefer the packaged copy
// if it matches the embedded one. Keep that inode open for OpenTUI's later dlopen, even during a package update.
export function packagedRenderer(size: number, digest: string, directory = path.dirname(process.execPath)) {
  let fd: number | undefined
  try {
    fd = openSync(
      path.join(directory, "libopentui.dylib"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const stat = fstatSync(fd)
    if (
      stat.isFile() &&
      stat.size === size &&
      !(stat.mode & 0o022) &&
      (stat.uid === 0 || stat.uid === process.getuid?.())
    ) {
      const bytes = Buffer.allocUnsafe(size)
      if (readSync(fd, bytes, 0, size, 0) === size && createHash("sha256").update(bytes).digest("hex") === digest)
        return `/dev/fd/${fd}`
    }
  } catch {
    // Missing, inaccessible or incomplete install: fall back to the library already inside the binary.
  }
  if (fd !== undefined) closeSync(fd)
  return undefined
}
