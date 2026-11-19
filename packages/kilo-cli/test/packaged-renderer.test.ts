import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { closeSync, readSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { packagedRenderer } from "../src/packaged-renderer"

test.skipIf(process.platform !== "darwin")(
  "only the matching sidecar is offered to dlopen, at offset zero",
  async () => {
    await using root = await tmpdir()
    const sidecar = path.join(root.path, "libopentui.dylib")
    const bytes = Buffer.from("renderer")
    const digest = createHash("sha256").update(bytes).digest("hex")
    expect(packagedRenderer(bytes.length, digest, root.path)).toBeUndefined()
    await Bun.write(sidecar, "modified")
    expect(packagedRenderer(bytes.length, digest, root.path)).toBeUndefined()
    await Bun.write(sidecar, bytes)
    const file = packagedRenderer(bytes.length, digest, root.path)
    if (!file) throw new Error("Expected the verified renderer descriptor")
    const fd = Number(path.basename(file))
    try {
      const actual = Buffer.alloc(bytes.length)
      expect(readSync(fd, actual, 0, bytes.length, null)).toBe(bytes.length)
      expect(actual).toEqual(bytes)
    } finally {
      closeSync(fd)
    }
  },
)
