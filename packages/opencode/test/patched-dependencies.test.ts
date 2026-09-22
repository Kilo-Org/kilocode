import { describe, expect, test } from "bun:test"
import path from "path"

// Bun applies a patch only to the exact `name@version` named in
// `patchedDependencies`. Bumping the dependency without regenerating the patch
// does not fail `bun install`; the patch just stops applying and the runtime
// silently loses whatever the patch fixed. This pins the two together for the
// packages that ship in the CLI.
const root = path.resolve(import.meta.dir, "../../..")
const workspaces = ["packages/opencode", "packages/core"]
const patched = (await Bun.file(path.join(root, "package.json")).json()).patchedDependencies as Record<string, string>

describe("patched dependencies", () => {
  for (const key of Object.keys(patched)) {
    const at = key.lastIndexOf("@")
    const name = key.slice(0, at)
    const version = key.slice(at + 1)

    test(`${key} matches the installed version`, async () => {
      expect(await Bun.file(path.join(root, patched[key])).exists()).toBe(true)
      for (const workspace of workspaces) {
        const file = Bun.file(path.join(root, workspace, "node_modules", name, "package.json"))
        if (!(await file.exists())) continue
        const installed = (await file.json()).version as string
        // kilocode_change - Kilo intentionally patches more than one version of some
        // dependencies (for example @ai-sdk/openai-compatible 2.0.41 for a nested consumer
        // and 2.0.48 for the direct dependency). A workspace that resolves another patched
        // version of the same name is still pinned, so only keep the guard when the
        // installed version has no patch entry of its own.
        if (installed !== version && `${name}@${installed}` in patched) continue
        expect(installed, `${workspace} resolves ${name}@${installed}; patch is for ${version}`).toBe(version)
      }
    })
  }
})
