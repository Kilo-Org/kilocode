import { expect, test } from "bun:test"
import path from "node:path"
import { KiloBranding } from "../src/branding/text"
import { legacyReplacements, legacyTransform } from "./fixtures/legacy-branding"

const repo = path.resolve(import.meta.dir, "../../..")

// Phase-1 safety net: the rule-based transform must reproduce the pre-refactor
// exact-list transform byte-for-byte over every intercepted file at the current
// upstream pin. A divergence here is either a refactor regression or a string
// the legacy list missed; both must be understood before the legacy fixture is
// deleted in phase 2.
for (const file of Object.keys(legacyReplacements)) {
  test(`rule-based transform matches the legacy list for ${file}`, async () => {
    const filename = path.join(repo, "packages", file)
    const source = await Bun.file(filename).text()
    expect(KiloBranding.transform(filename, source)).toBe(legacyTransform(filename, source))
  })
}
