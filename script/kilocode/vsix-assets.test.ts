import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assets } from "./vsix-assets"
import * as Artifact from "./sbom/artifact"

test("uploads exactly the VS Code files build-vscode recorded", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsix-assets-"))
  try {
    const lines = []
    for (const name of [
      "kilo-vscode-linux-x64.vsix",
      "kilo-vscode-linux-x64.vsix.cdx.json",
      "kilo-vscode-SHA256SUMS",
    ]) {
      await writeFile(path.join(dir, name), `bytes of ${name}`)
      lines.push(`${await Artifact.digest(path.join(dir, name))}  ${name}`)
    }
    const text = lines.join("\n")
    expect((await assets(dir, text)).map((file) => path.basename(file)).sort()).toEqual(
      ["kilo-vscode-SHA256SUMS", "kilo-vscode-linux-x64.vsix", "kilo-vscode-linux-x64.vsix.cdx.json"].sort(),
    )

    await writeFile(path.join(dir, "kilo-vscode-linux-x64.vsix"), "changed")
    await assert.rejects(() => assets(dir, text), /kilo-vscode-linux-x64\.vsix: digest mismatch/)
    await writeFile(path.join(dir, "kilo-vscode-linux-x64.vsix"), "bytes of kilo-vscode-linux-x64.vsix")

    await writeFile(path.join(dir, "extra.vsix"), "extra")
    await assert.rejects(() => assets(dir, text), /extra\.vsix: not listed by build-vscode/)
    await rm(path.join(dir, "extra.vsix"))

    await rm(path.join(dir, "kilo-vscode-SHA256SUMS"))
    await assert.rejects(() => assets(dir, text), /Unexpected VS Code package set/)
    await mkdir(path.join(dir, "kilo-vscode-SHA256SUMS"))
    await assert.rejects(() => assets(dir, text), /expected only regular files/)
    await assert.rejects(() => assets(dir, ""), /build-vscode recorded no digests/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
