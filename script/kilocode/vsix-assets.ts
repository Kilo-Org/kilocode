import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { list } from "./draft-assets.ts"
import { release, upload } from "./release.ts"
import { digest } from "./sbom/artifact.ts"

/**
 * The files of packages/kilo-vscode/out (VSIX packages, their sidecars, manifest and checksum
 * file) that go to the draft release, checked against build-vscode's digest list. The directory
 * must hold exactly the listed files.
 */
export async function assets(dir: string, text: string) {
  const expected = list(text, "build-vscode")
  const files = []
  const names = []
  for (const file of await readdir(dir, { withFileTypes: true })) {
    assert(file.isFile(), `${file.name}: expected only regular files`)
    names.push(file.name)
    const want = expected.get(file.name)
    assert(want, `${file.name}: not listed by build-vscode`)
    assert.equal(await digest(path.join(dir, file.name)), want, `${file.name}: digest mismatch`)
    files.push(path.join(dir, file.name))
  }
  assert.deepEqual(names.sort(), [...expected.keys()].sort(), "Unexpected VS Code package set")
  return files
}

if (import.meta.main) {
  const [dir, tag] = process.argv.slice(2)
  const id = process.env.KILO_RELEASE ?? ""
  const files = await assets(dir, process.env.VSIX_SHA256 ?? "")
  // A re-run after the release was published uploads nothing; the next step checks the published assets.
  if (!(await release(id, tag)).draft) console.log(`Release ${tag} (${id}) is already published; nothing was uploaded.`)
  else await upload({ tag, release: id, files })
}
