/**
 * Regression: when provider is `kilo`, the IndexingTab must NOT show a
 * free-text "Embedding model" override or a "Dimension" field. The Kilo
 * embedding catalog is Cloud-managed: users pick a model from the Select
 * (which determines the dimension server-side). A free-text TextField
 * leaked through previously and rendered the literal placeholder
 * "provider/model" whenever the catalog hadn't loaded yet.
 *
 * Source-level assertions (rather than full Solid render) keep this test
 * cheap and stable across UI library upgrades.
 */

import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const SOURCE = fs.readFileSync(
  path.resolve(import.meta.dir, "../../webview-ui/src/components/settings/IndexingTab.tsx"),
  "utf8",
)

describe("IndexingTab kilo branch", () => {
  it("does not contain the legacy 'provider/model' placeholder fallback", () => {
    expect(SOURCE).not.toContain('"provider/model"')
  })

  it("renders the Kilo model preset Select inside the kilo branch", () => {
    // The Select for the catalog must reference kiloModels(). The kilo branch
    // is the body of <Show when={selectedProvider() === "kilo"}>, so the
    // Select must appear after that line.
    const showIdx = SOURCE.indexOf('selectedProvider() === "kilo"')
    expect(showIdx).toBeGreaterThan(-1)

    const after = SOURCE.slice(showIdx)
    expect(after).toContain("options={kiloModels()}")
    expect(after).toContain("settings.indexing.kiloModel.title")
  })

  it("places the free-text Embedding model TextField in the non-kilo fallback only", () => {
    // The "Embedding model" row uses settings.indexing.model.title. It must
    // appear only inside the `fallback={...}` of the kilo Show, not in the
    // main branch.
    const fallbackIdx = SOURCE.indexOf("fallback={")
    expect(fallbackIdx).toBeGreaterThan(-1)

    const fallbackEnd = SOURCE.indexOf("}\n        >", fallbackIdx)
    expect(fallbackEnd).toBeGreaterThan(fallbackIdx)

    const fallbackBlock = SOURCE.slice(fallbackIdx, fallbackEnd)
    expect(fallbackBlock).toContain("settings.indexing.model.title")
    expect(fallbackBlock).toContain("settings.indexing.dimension.title")
    expect(fallbackBlock).toContain("text-embedding-3-small")

    // The kilo branch (after the fallback) must NOT reference the override
    // model or dimension rows.
    const kiloBranch = SOURCE.slice(fallbackEnd)
    expect(kiloBranch).not.toContain("settings.indexing.model.title")
    expect(kiloBranch).not.toContain("settings.indexing.dimension.title")
  })

  it("disables the kilo Select while the catalog is empty so users cannot select stale state", () => {
    expect(SOURCE).toContain("disabled={kiloModels().length === 0}")
  })
})
