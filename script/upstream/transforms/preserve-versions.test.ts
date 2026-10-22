import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { preserveZedVersion } from "./preserve-versions"

describe("preserveZedVersion", () => {
  test("preserves the Kilo extension version and release archives", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kilo-zed-version-"))
    const file = join(dir, "extension.toml")
    try {
      await writeFile(
        file,
        [
          'version = "1.14.42"',
          'archive = "https://github.com/Kilo-Org/kilocode/releases/download/v1.14.42/opencode-linux-x64.tar.gz"',
          "",
        ].join("\n"),
      )

      expect(await preserveZedVersion(file, { targetVersion: "7.3.18" })).toMatchObject({
        file,
        originalVersion: "1.14.42",
        preserved: true,
      })
      expect(await readFile(file, "utf8")).toBe(
        [
          'version = "7.3.18"',
          'archive = "https://github.com/Kilo-Org/kilocode/releases/download/v7.3.18/opencode-linux-x64.tar.gz"',
          "",
        ].join("\n"),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
