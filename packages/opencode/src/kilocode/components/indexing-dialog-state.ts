import type { IndexingConfig } from "@kilocode/sdk/v2"
import { createMemo, type Accessor } from "solid-js"

export type IndexingScope = "global" | "project"

export function createIndexingDialogState(input: {
  scope: Accessor<IndexingScope>
  global: Accessor<IndexingConfig>
  project: Accessor<IndexingConfig>
  resolve: (indexing: IndexingConfig, global: IndexingConfig) => IndexingConfig
}) {
  const raw = createMemo(() => (input.scope() === "global" ? input.global() : input.project()))
  const config = createMemo(() => input.resolve(raw(), input.global()))
  const enabled = createMemo(() => {
    if (input.scope() === "global") return raw().enabled === true
    return (raw().enabled ?? input.global().enabled) === true
  })
  const inherited = createMemo(
    () => input.scope() === "project" && raw().enabled === undefined && input.global().enabled !== undefined,
  )

  return { raw, config, enabled, inherited }
}
